import { Injectable, Logger } from '@nestjs/common';
import {
  DISPATCH_MAX_OFFERS,
  DISPATCH_OFFER_TIMEOUT_SECONDS,
  rankDrivers,
  type DriverCandidate,
} from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DriverService } from '../driver/driver.service';
import { DispatchService } from './dispatch.service';
import { DeliveryCoreService } from './delivery-core.service';

/** Effective dispatch configuration, read from the platform settings singleton. */
export interface DispatchSettings {
  automatic: boolean;
  offerTimeoutSeconds: number;
  maxOffers: number;
  maxConcurrentPerDriver: number;
}

export type DispatchOutcome =
  | { result: 'ASSIGNED'; driverProfileId: string; offerCount: number }
  | { result: 'NO_CANDIDATES' }
  | { result: 'EXHAUSTED' }
  | { result: 'SKIPPED'; reason: string };

/**
 * Automatic dispatch (M26.3 · Part 4).
 *
 * Replaces `DispatchService.autoAssignPreview`, which was an explicit stub
 * returning `implemented: false` — meaning every delivery on the platform waited
 * for an administrator to assign it by hand.
 *
 * This engine does NOT own any business rules. Eligibility comes from
 * DriverService (`assignmentEligibility`, `eligibleDriversForDistrict`), ranking
 * from the pure module in @bmpl/shared, and the assignment write — PIN
 * generation, assignment history, timeline, audit, notifications, messaging —
 * from DispatchService.systemAssign. Its only job is deciding WHO and WHEN.
 * Two places deciding whether a driver may take a job is how the two drift.
 *
 * Offers go to one driver at a time rather than broadcasting. A broadcast races
 * several drivers to one job and disappoints all but one; a rolling single offer
 * with a timeout keeps the outcome deterministic and the history honest.
 */
@Injectable()
export class DispatchEngineService {
  private readonly logger = new Logger(DispatchEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly drivers: DriverService,
    private readonly assignments: DispatchService,
    private readonly core: DeliveryCoreService,
  ) {}

  /** Effective settings, falling back to the tested defaults when unset. */
  async settings(): Promise<DispatchSettings> {
    const row = await this.prisma.platformSetting.findFirst();
    return {
      // Defaults OFF, including when no settings row exists at all. Dispatch
      // moves real orders, so "not configured" must mean "do nothing" rather
      // than "do everything" — the safe direction for a missing row.
      automatic: row?.dispatchAutomatic ?? false,
      offerTimeoutSeconds: row?.dispatchOfferTimeoutSeconds ?? DISPATCH_OFFER_TIMEOUT_SECONDS,
      maxOffers: row?.dispatchMaxOffers ?? DISPATCH_MAX_OFFERS,
      maxConcurrentPerDriver: row?.dispatchMaxConcurrentPerDriver ?? 3,
    };
  }

  /**
   * Offer a delivery to the best available driver.
   *
   * Safe to call repeatedly: it re-reads state and no-ops when the delivery is
   * already held, not yet ready, or past its retry budget. That matters because
   * it is called from a vendor action, from the sweeper, and after a decline.
   */
  async dispatch(deliveryId: string): Promise<DispatchOutcome> {
    const cfg = await this.settings();
    if (!cfg.automatic) return { result: 'SKIPPED', reason: 'automatic dispatch is disabled' };

    const delivery = await this.prisma.orderDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        offerCount: true,
        readyForDispatchAt: true,
        vendorOrder: {
          select: {
            order: {
              select: { orderNumber: true, addresses: { select: { district: true } } },
            },
          },
        },
      },
    });
    if (!delivery) return { result: 'SKIPPED', reason: 'delivery not found' };

    // Only an unheld delivery is dispatchable. DRIVER_DECLINED is included
    // deliberately — a decline should roll straight to the next driver.
    if (delivery.status !== 'PENDING_ASSIGNMENT' && delivery.status !== 'DRIVER_DECLINED') {
      return { result: 'SKIPPED', reason: `delivery is ${delivery.status}` };
    }
    if (!delivery.readyForDispatchAt) {
      return { result: 'SKIPPED', reason: 'vendor has not marked the order ready' };
    }
    if (delivery.offerCount >= cfg.maxOffers) {
      await this.markExhausted(deliveryId, delivery.offerCount);
      return { result: 'EXHAUSTED' };
    }

    const district = this.districtOf(delivery.vendorOrder.order.addresses);
    if (!district) return { result: 'SKIPPED', reason: 'delivery has no destination district' };

    const ranked = await this.rankFor(deliveryId, district, cfg);
    if (ranked.length === 0) {
      // Not exhausted — nobody is online right now. The sweeper retries, so a
      // quiet hour resolves itself once a driver comes online.
      await this.core.notifyAdmins('deliveries.assign', {
        title: 'No driver available',
        body: `Order ${delivery.vendorOrder.order.orderNumber} is packed but no eligible driver is online.`,
        data: { deliveryId },
        category: 'ADMIN_ALERT',
      });
      return { result: 'NO_CANDIDATES' };
    }

    // Re-check eligibility for the chosen driver at assignment time — the pool
    // query and this moment are not the same instant, and someone may have gone
    // offline or had a document lapse in between. systemAssign re-checks too;
    // this loop just moves on to the next candidate instead of failing the batch.
    for (const candidate of ranked) {
      const vehicleId = await this.pickVehicle(candidate.driverProfileId, district);
      if (!vehicleId) continue;
      try {
        await this.assignments.systemAssign(deliveryId, candidate.driverProfileId, vehicleId);
      } catch (err) {
        this.logger.warn(`candidate ${candidate.driverProfileId} became ineligible: ${String(err)}`);
        continue;
      }
      const offerCount = delivery.offerCount + 1;
      await this.prisma.orderDelivery.update({
        where: { id: deliveryId },
        data: {
          offerCount,
          offerExpiresAt: new Date(Date.now() + cfg.offerTimeoutSeconds * 1000),
        },
      });
      await this.audit.record({
        action: 'DELIVERY_AUTO_ASSIGNED',
        actorId: null,
        newValue: {
          deliveryId,
          driverProfileId: candidate.driverProfileId,
          score: Math.round(candidate.score),
          offerCount,
        },
      });
      return { result: 'ASSIGNED', driverProfileId: candidate.driverProfileId, offerCount };
    }

    return { result: 'NO_CANDIDATES' };
  }

  /**
   * Roll forward every offer whose timer has run out.
   *
   * A driver who never responds must not hold a customer's order indefinitely.
   * Returns counts so the caller can log a single line rather than one per row.
   */
  async sweepExpiredOffers(now: Date = new Date()): Promise<{ expired: number; reassigned: number }> {
    const cfg = await this.settings();
    if (!cfg.automatic) return { expired: 0, reassigned: 0 };

    const stale = await this.prisma.orderDelivery.findMany({
      where: {
        status: 'ASSIGNED',
        acceptedAt: null, // an accepted job is the driver's; only unanswered offers lapse
        offerExpiresAt: { lt: now },
      },
      select: { id: true, assignedDriverProfileId: true },
      take: 50, // bounded per tick so one backlog cannot monopolise a run
    });

    let reassigned = 0;
    for (const d of stale) {
      try {
        await this.expireOffer(d.id, d.assignedDriverProfileId);
        const outcome = await this.dispatch(d.id);
        if (outcome.result === 'ASSIGNED') reassigned += 1;
      } catch (err) {
        this.logger.error(`offer sweep failed for ${d.id}: ${String(err)}`);
      }
    }
    return { expired: stale.length, reassigned };
  }

  /** Pick up deliveries that are ready but unheld — a safety net for missed triggers. */
  async sweepUndispatched(): Promise<number> {
    const cfg = await this.settings();
    if (!cfg.automatic) return 0;
    const waiting = await this.prisma.orderDelivery.findMany({
      where: {
        status: { in: ['PENDING_ASSIGNMENT', 'DRIVER_DECLINED'] },
        readyForDispatchAt: { not: null },
        dispatchExhaustedAt: null,
      },
      select: { id: true },
      take: 50,
    });
    let assigned = 0;
    for (const d of waiting) {
      try {
        if ((await this.dispatch(d.id)).result === 'ASSIGNED') assigned += 1;
      } catch (err) {
        this.logger.error(`dispatch sweep failed for ${d.id}: ${String(err)}`);
      }
    }
    return assigned;
  }

  // ---- internals ------------------------------------------------------------

  /**
   * Build ranking inputs for every eligible driver in the district.
   *
   * Workload and last-assignment are loaded in two grouped queries rather than
   * per driver — the pool is up to 200 rows, and a per-driver round trip here
   * would be an N+1 on the hottest path in the system.
   */
  private async rankFor(deliveryId: string, district: string, cfg: DispatchSettings) {
    const pool = await this.drivers.eligibleDriversForDistrict(district);
    if (pool.length === 0) return [];
    const ids = pool.map((d) => d.driverProfileId);

    const [workload, lastAssignments, priorOffers] = await Promise.all([
      this.prisma.orderDelivery.groupBy({
        by: ['assignedDriverProfileId'],
        where: {
          assignedDriverProfileId: { in: ids },
          status: { in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] },
        },
        _count: { _all: true },
      }),
      this.prisma.deliveryAssignment.groupBy({
        by: ['driverProfileId'],
        where: { driverProfileId: { in: ids } },
        _max: { assignedAt: true },
      }),
      // Drivers who already saw THIS delivery — they rank last rather than being
      // dropped, so a job everyone passed on can still find someone.
      this.prisma.deliveryAssignment.findMany({
        where: { orderDeliveryId: deliveryId, driverProfileId: { in: ids } },
        select: { driverProfileId: true },
        distinct: ['driverProfileId'],
      }),
    ]);

    const activeBy = new Map(workload.map((w) => [w.assignedDriverProfileId, w._count._all]));
    const lastBy = new Map(lastAssignments.map((a) => [a.driverProfileId, a._max.assignedAt]));
    const offered = new Set(priorOffers.map((o) => o.driverProfileId));

    const candidates: DriverCandidate[] = pool
      .map((d) => ({
        driverProfileId: d.driverProfileId,
        activeDeliveries: activeBy.get(d.driverProfileId) ?? 0,
        lastAssignedAt: lastBy.get(d.driverProfileId) ?? null,
        ratingAverage: d.ratingAverage,
        completedDeliveries: d.completedDeliveries,
        isLocal: d.homeDistrict === district,
        previouslyOffered: offered.has(d.driverProfileId),
      }))
      // A hard cap, not a scoring penalty: past this a driver physically cannot
      // service more drops well, however good their score.
      .filter((c) => c.activeDeliveries < cfg.maxConcurrentPerDriver);

    return rankDrivers(candidates, new Date());
  }

  /** The driver's primary usable vehicle for this district, if any. */
  private async pickVehicle(driverProfileId: string, district: string): Promise<string | null> {
    const e = await this.drivers.assignmentEligibility(driverProfileId, district);
    if (!e.eligible || e.usableVehicles.length === 0) return null;
    return (e.usableVehicles.find((v) => v.isPrimary) ?? e.usableVehicles[0])!.id;
  }

  /** Release a lapsed offer so the delivery is dispatchable again. */
  private async expireOffer(deliveryId: string, driverProfileId: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryAssignment.updateMany({
        where: { orderDeliveryId: deliveryId, status: 'ACTIVE' },
        data: { status: 'DECLINED', endedAt: new Date(), endReason: 'Offer expired' },
      });
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DRIVER_DECLINED',
          declinedAt: new Date(),
          declineReason: 'No response before the offer expired',
          offerExpiresAt: null,
          assignedDriverProfileId: null,
          assignedVehicleId: null,
        },
      });
      await this.core.appendTimeline(tx, deliveryId, {
        fromStatus: 'ASSIGNED',
        toStatus: 'DRIVER_DECLINED',
        event: 'OFFER_EXPIRED',
        actorRole: 'SYSTEM',
        note: 'The driver did not respond in time.',
      });
    });
    await this.audit.record({
      action: 'DELIVERY_OFFER_EXPIRED',
      actorId: null,
      newValue: { deliveryId, driverProfileId },
    });
  }

  /** Retry budget spent — this is the one case a human genuinely is needed. */
  private async markExhausted(deliveryId: string, offerCount: number): Promise<void> {
    await this.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { dispatchExhaustedAt: new Date(), offerExpiresAt: null },
    });
    await this.audit.record({
      action: 'DELIVERY_DISPATCH_EXHAUSTED',
      actorId: null,
      newValue: { deliveryId, offerCount },
    });
    await this.core.notifyAdmins('deliveries.assign', {
      title: 'Delivery needs manual assignment',
      body: `A delivery was offered to ${offerCount} drivers without being accepted.`,
      data: { deliveryId },
      category: 'ADMIN_ALERT',
    });
  }

  /**
   * Destination district. Matches DispatchService.districtOrThrow exactly rather
   * than introducing a second, subtly different rule for the same question —
   * automatic and manual assignment must agree on where a delivery is going.
   */
  private districtOf(addresses: Array<{ district: string }>): string | null {
    return addresses[0]?.district ?? null;
  }
}
