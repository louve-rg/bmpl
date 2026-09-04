import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  canPerform,
  DELIVERY_STATUS_LABELS,
  isLegActionable,
  rankDrivers,
  type DriverCandidate,
  type LegView,
} from '@bmpl/shared';
import type { AssignShipmentLegInput, ReassignShipmentLegInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverService } from '../driver/driver.service';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';

export type LegDispatchOutcome =
  | { result: 'OFFERED'; driverProfileId: string }
  | { result: 'SKIPPED'; reason: string }
  | { result: 'EXHAUSTED' };

/**
 * Offering a courier leg to a driver.
 *
 * This is NOT a second dispatch engine. Everything that decides whether a driver
 * may take work stays where it already lives: eligibility and service areas come
 * from DriverService, ranking from the pure module in @bmpl/shared, and the
 * offer timeout / retry budget / concurrency cap from the delivery engine's own
 * settings. Two places deciding who may drive is how the two drift.
 *
 * What is genuinely new is small and unavoidable: the offer is written to a
 * different table. A shipment leg is not an OrderDelivery and cannot be made
 * into one — OrderDelivery requires a vendor order and permits exactly one per
 * order, so a shipment's first AND last mile could never both be one.
 *
 * The rule this service exists to respect: a leg is only ever offered when the
 * parcel is physically where the driver is being sent. `isLegActionable` decides
 * that, and it is the same function the shipment layer uses — no courier is sent
 * to a terminal a parcel is still flying towards.
 */
@Injectable()
export class ShipmentDispatchService {
  private readonly logger = new Logger(ShipmentDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly drivers: DriverService,
    private readonly engine: DispatchEngineService,
  ) {}

  /**
   * Offer one courier leg to the best available driver.
   *
   * Safe to call repeatedly: it re-reads state and no-ops when the leg is held,
   * not yet its turn, or past its retry budget. It is called when a shipment is
   * booked, when the previous leg completes, when a driver declines, and from the
   * sweeper — so idempotence is the only workable contract.
   */
  async dispatchLeg(legId: string): Promise<LegDispatchOutcome> {
    const cfg = await this.engine.settings();
    if (!cfg.automatic) return { result: 'SKIPPED', reason: 'automatic dispatch is disabled' };

    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: {
        id: true,
        kind: true,
        status: true,
        courierStatus: true,
        offerCount: true,
        sequence: true,
        originHubId: true,
        originHub: { select: { district: true } },
        shipment: {
          select: {
            id: true,
            reference: true,
            isTest: true,
            // Who booked the shipment — kept out of the courier pool for their
            // own parcel, on both the first mile and the last.
            customerUserId: true,
            originDistrict: true,
            quotedTotalMinor: true,
            payment: { select: { status: true } },
            legs: { select: { sequence: true, kind: true, mode: true, status: true } },
          },
        },
      },
    });
    if (!leg) return { result: 'SKIPPED', reason: 'leg not found' };
    if (leg.kind === 'LINE_HAUL') return { result: 'SKIPPED', reason: 'a transport leg is operated by a carrier, not a driver' };

    // THE payment invariant. An unpaid shipment must never become a driver's
    // job. Leg statuses already encode this — an unpaid booking leaves them all
    // PENDING — but this is the check that makes it true regardless of how the
    // leg got here, including a future caller that sets a status directly.
    if (!(await this.isPaidFor(leg.shipment))) {
      return { result: 'SKIPPED', reason: 'the shipment has not been paid for' };
    }
    if (leg.courierStatus != null && leg.courierStatus !== 'PENDING_ASSIGNMENT' && leg.courierStatus !== 'DRIVER_DECLINED') {
      return { result: 'SKIPPED', reason: `leg is ${leg.courierStatus}` };
    }

    // THE invariant. A last-mile leg whose line-haul is still in the air is not
    // dispatchable, however many times this is called.
    if (!isLegActionable(leg.shipment.legs as LegView[], leg.sequence)) {
      return { result: 'SKIPPED', reason: 'the parcel has not reached this leg yet' };
    }

    if (leg.offerCount >= cfg.maxOffers) {
      await this.markExhausted(leg.id, leg.shipment.reference, leg.offerCount);
      return { result: 'EXHAUSTED' };
    }

    // Where the driver has to BE to start: a first mile and a door-to-door run
    // both collect from the sender's district; a last mile collects from the
    // arrival terminal.
    const district =
      leg.kind === 'FIRST_MILE' || leg.kind === 'DIRECT' ? leg.shipment.originDistrict : leg.originHub?.district;
    if (!district) return { result: 'SKIPPED', reason: 'no district to search for drivers in' };

    const ranked = await this.rankFor(
      leg.id,
      district,
      cfg.maxConcurrentPerDriver,
      leg.shipment.isTest,
      leg.shipment.customerUserId,
    );
    if (ranked.length === 0) {
      // Not exhausted — nobody is online right now. The sweeper will try again.
      return { result: 'SKIPPED', reason: 'no eligible driver is available' };
    }

    const chosen = ranked[0]!;

    // The pool query already excluded the sender, so reaching this with the
    // sender selected means something upstream is wrong. Refuse rather than
    // offer: a courier leg exists so that somebody other than the sender carries
    // the parcel, and a sender who is also the courier can confirm their own
    // collection and their own delivery with nobody independent in the chain.
    const chosenUserId = await this.prisma.driverProfile
      .findUnique({ where: { id: chosen.driverProfileId }, select: { userId: true } })
      .then((p) => p?.userId ?? null);
    if (chosenUserId && chosenUserId === leg.shipment.customerUserId) {
      this.logger.error(
        `refusing to offer leg ${leg.id} to the sender's own driver profile ${chosen.driverProfileId}`,
      );
      return { result: 'SKIPPED', reason: 'the only candidate was the sender, who cannot courier their own parcel' };
    }

    const vehicleId = await this.pickVehicle(chosen.driverProfileId, district, leg.shipment.isTest);
    const expiresAt = new Date(Date.now() + cfg.offerTimeoutSeconds * 1000);

    const won = await this.prisma.$transaction(async (tx) => {
      // Conditional, not an update by id: the sweeper and a completing previous
      // leg can both reach this line. Exactly one of them may write the offer.
      const claimed = await tx.shipmentLeg.updateMany({
        where: {
          id: leg.id,
          assignedDriverProfileId: null,
          courierStatus: leg.courierStatus ?? null,
        },
        data: {
          courierStatus: 'ASSIGNED',
          assignedDriverProfileId: chosen.driverProfileId,
          assignedVehicleId: vehicleId,
          assignedAt: new Date(),
          offerExpiresAt: expiresAt,
          offerCount: { increment: 1 },
          declinedAt: null,
          declineReason: null,
        },
      });
      if (claimed.count === 0) return false;
      // History and denormalized state commit together, or neither does. An
      // offer the leg remembers but the history does not would let the same
      // driver be asked twice.
      await tx.shipmentLegOffer.create({
        data: { shipmentLegId: leg.id, driverProfileId: chosen.driverProfileId, vehicleId, status: 'ACTIVE' },
      });
      await this.audit.record(
        {
          action: 'SHIPMENT_LEG_OFFERED',
          newValue: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference, driverProfileId: chosen.driverProfileId, offer: leg.offerCount + 1 },
        },
        tx,
      );
      return true;
    });
    if (!won) return { result: 'SKIPPED', reason: 'another dispatcher got there first' };
    await this.notifyDriver(chosen.driverProfileId, leg.id, leg.kind, leg.shipment.reference);
    return { result: 'OFFERED', driverProfileId: chosen.driverProfileId };
  }

  /**
   * Rank the eligible drivers in a district.
   *
   * The one thing this cannot borrow wholesale from the delivery engine is the
   * workload count, which has to span BOTH tables: a driver already holding
   * three marketplace deliveries is not free to take a shipment leg as well, and
   * counting only one table would quietly hand them a fourth job.
   */
  private async rankFor(
    legId: string,
    district: string,
    maxConcurrent: number,
    isTest: boolean,
    requesterUserId?: string | null,
  ) {
    const pool = await this.drivers.eligibleDriversForDistrict(district, { isTest, excludeUserId: requesterUserId });
    if (pool.length === 0) return [];
    const ids = pool.map((d) => d.driverProfileId);

    const [deliveryLoad, legLoad, lastAssignments, priorOffers] = await Promise.all([
      this.prisma.orderDelivery.groupBy({
        by: ['assignedDriverProfileId'],
        where: {
          assignedDriverProfileId: { in: ids },
          status: { in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] },
        },
        _count: { _all: true },
      }),
      this.prisma.shipmentLeg.groupBy({
        by: ['assignedDriverProfileId'],
        where: {
          assignedDriverProfileId: { in: ids },
          courierStatus: { in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] },
        },
        _count: { _all: true },
      }),
      // Fairness looks at ALL their recent work, not just shipping. A driver who
      // took a marketplace delivery a minute ago is not the idlest candidate.
      this.prisma.deliveryAssignment.groupBy({
        by: ['driverProfileId'],
        where: { driverProfileId: { in: ids } },
        _max: { assignedAt: true },
      }),
      // Drivers who have already seen THIS leg rank last rather than being
      // dropped, so a leg everyone passed on can still find someone.
      this.prisma.shipmentLegOffer.findMany({
        where: { shipmentLegId: legId, driverProfileId: { in: ids } },
        select: { driverProfileId: true },
        distinct: ['driverProfileId'],
      }),
    ]);

    const load = new Map<string, number>();
    for (const row of [...deliveryLoad, ...legLoad]) {
      if (!row.assignedDriverProfileId) continue;
      load.set(row.assignedDriverProfileId, (load.get(row.assignedDriverProfileId) ?? 0) + row._count._all);
    }
    const legOffers = await this.prisma.shipmentLegOffer.groupBy({
      by: ['driverProfileId'],
      where: { driverProfileId: { in: ids } },
      _max: { assignedAt: true },
    });
    const lastBy = new Map<string, Date | null>();
    for (const row of lastAssignments) lastBy.set(row.driverProfileId, row._max.assignedAt);
    for (const row of legOffers) {
      const seen = lastBy.get(row.driverProfileId);
      const at = row._max.assignedAt;
      if (at && (!seen || at > seen)) lastBy.set(row.driverProfileId, at);
    }
    const offered = new Set(priorOffers.map((o) => o.driverProfileId));

    const candidates: DriverCandidate[] = pool
      .map((d) => ({
        driverProfileId: d.driverProfileId,
        activeDeliveries: load.get(d.driverProfileId) ?? 0,
        lastAssignedAt: lastBy.get(d.driverProfileId) ?? null,
        ratingAverage: d.ratingAverage,
        completedDeliveries: d.completedDeliveries,
        isLocal: d.homeDistrict === district,
        previouslyOffered: offered.has(d.driverProfileId),
      }))
      .filter((c) => c.activeDeliveries < maxConcurrent);

    return rankDrivers(candidates, new Date());
  }

  private async pickVehicle(driverProfileId: string, district: string, isTest: boolean): Promise<string | null> {
    const e = await this.drivers.assignmentEligibility(driverProfileId, district, undefined, { isTestDelivery: isTest });
    if (!e.eligible || e.usableVehicles.length === 0) return null;
    return (e.usableVehicles.find((v) => v.isPrimary) ?? e.usableVehicles[0])!.id;
  }

  /* ------------------------------------------------ admin manual assignment */

  /**
   * The eligible pool for one courier leg, for the admin console to choose from.
   * Same filters the assignment itself will apply — the matching side of the
   * simulation boundary, never the sender — so an administrator is not offered
   * a choice the assignment would then refuse.
   */
  async eligibleDriversForLeg(legId: string) {
    const leg = await this.loadForAssignment(legId);
    const district = this.districtFor(leg);
    return this.drivers.eligibleDriversForDistrict(district, {
      isTest: leg.shipment.isTest,
      excludeUserId: leg.shipment.customerUserId,
    });
  }

  async adminAssign(actor: { userId: string }, legId: string, dto: AssignShipmentLegInput) {
    return this.assignManual(actor, legId, dto.driverProfileId, dto.vehicleId, null, 'ASSIGN');
  }

  async adminReassign(actor: { userId: string }, legId: string, dto: ReassignShipmentLegInput) {
    return this.assignManual(actor, legId, dto.driverProfileId, dto.vehicleId, dto.reason, 'REASSIGN');
  }

  /**
   * An administrator assigns a courier leg by hand.
   *
   * This is THE production path: `dispatchAutomatic` is deliberately OFF in
   * production, so `dispatchLeg` always skips and the dispatch-exhausted alert's
   * "Assign one by hand" was, until this method, an instruction with no endpoint
   * behind it. Mirrors DispatchService.assignInternal for deliveries: the same
   * state-machine vocabulary (courierStatus reuses DeliveryStatus, so
   * DELIVERY_ACTIONS.ASSIGN/REASSIGN apply unchanged), the same assignment-time
   * eligibility re-check, the same append-only offer history, the same
   * conditional-claim concurrency, one audit row.
   *
   * Every refusal the automatic path enforces holds here too — an administrator
   * is not an exemption from an invariant:
   *  - an unpaid shipment is never dispatched;
   *  - a leg is only assigned when the parcel is physically there;
   *  - the simulation boundary is symmetric (via assignmentEligibility);
   *  - the sender never couriers their own parcel, matched on USER id.
   */
  private async assignManual(
    actor: { userId: string },
    legId: string,
    driverProfileId: string,
    vehicleId: string,
    reason: string | null,
    action: 'ASSIGN' | 'REASSIGN',
  ) {
    const leg = await this.loadForAssignment(legId);
    if (leg.kind === 'LINE_HAUL') {
      throw new BadRequestException('A transport leg is operated by a carrier, not a driver.');
    }

    // The payment invariant, exactly as dispatchLeg states it: an unpaid
    // shipment must never become a driver's job, whoever is asking.
    if (!(await this.isPaidFor(leg.shipment))) {
      throw new BadRequestException('This shipment has not been paid for; it cannot be given to a driver.');
    }

    // Same state machine as every driver action on a leg. A never-offered leg
    // has courierStatus null, which means PENDING_ASSIGNMENT.
    const current = leg.courierStatus ?? 'PENDING_ASSIGNMENT';
    if (!canPerform(action, current)) {
      throw new BadRequestException(
        `Cannot ${action.toLowerCase()} a leg that is "${DELIVERY_STATUS_LABELS[current]}".`,
      );
    }

    // THE dispatch invariant: no driver is sent where the parcel is not.
    if (!isLegActionable(leg.shipment.legs as LegView[], leg.sequence)) {
      throw new BadRequestException('The parcel has not reached this leg yet; it cannot be assigned.');
    }

    // Nobody couriers their own parcel. The pool the console showed already left
    // the sender out, but every assignment arrives here, so this is the line
    // that has to hold when an id is submitted by hand. Matched on the USER,
    // never the active role — switching roles does not make the sender a
    // different human being.
    const assignee = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { userId: true },
    });
    if (!assignee) throw new BadRequestException('That driver profile does not exist.');
    if (leg.shipment.customerUserId && assignee.userId === leg.shipment.customerUserId) {
      throw new BadRequestException('The sender cannot be assigned to courier their own parcel.');
    }

    // Eligibility AT ASSIGNMENT TIME, simulation boundary included — the one
    // authority every assignment path funnels through.
    const district = this.districtFor(leg);
    const e = await this.drivers.assignmentEligibility(driverProfileId, district, vehicleId, {
      isTestDelivery: leg.shipment.isTest,
    });
    if (!e.eligible) throw new BadRequestException(`Driver is not eligible: ${e.reasons.join('; ')}.`);

    const won = await this.prisma.$transaction(async (tx) => {
      // Append-only history: a superseded offer is marked REASSIGNED, never
      // deleted — same rule as DeliveryAssignment.
      if (action === 'REASSIGN') {
        await tx.shipmentLegOffer.updateMany({
          where: { shipmentLegId: leg.id, status: { in: ['ACTIVE', 'ACCEPTED'] } },
          data: { status: 'REASSIGNED', endedAt: new Date(), declineReason: reason },
        });
      }
      // Conditional claim, not an update by id: the sweeper, a completing
      // previous leg and a second administrator can all reach this line.
      // Exactly one write may land; anyone else sees the state moved on.
      const claimed = await tx.shipmentLeg.updateMany({
        where: {
          id: leg.id,
          courierStatus: leg.courierStatus ?? null,
          ...(action === 'ASSIGN' ? { assignedDriverProfileId: null } : {}),
        },
        data: {
          courierStatus: 'ASSIGNED',
          assignedDriverProfileId: driverProfileId,
          assignedVehicleId: vehicleId,
          assignedAt: new Date(),
          // A human's assignment does not lapse: the offer sweeper only expires
          // rows with an offerExpiresAt, exactly as admin-assigned deliveries
          // never time out.
          offerExpiresAt: null,
          // Human intervention answers the exhausted alarm; clearing it lets
          // decline → automatic re-offer resume if dispatch is ever re-enabled.
          dispatchExhaustedAt: null,
          acceptedAt: null,
          declinedAt: null,
          declineReason: null,
        },
      });
      if (claimed.count === 0) return false;
      await tx.shipmentLegOffer.create({
        data: { shipmentLegId: leg.id, driverProfileId, vehicleId, status: 'ACTIVE' },
      });
      await this.audit.record(
        {
          action: 'SHIPMENT_LEG_DRIVER_ASSIGNED',
          actorId: actor.userId,
          newValue: {
            legId: leg.id,
            shipmentId: leg.shipment.id,
            reference: leg.shipment.reference,
            driverProfileId,
            vehicleId,
            manner: action,
            reason,
          },
        },
        tx,
      );
      return true;
    });
    if (!won) {
      throw new BadRequestException('This leg changed while assigning (someone else got there first). Reload and try again.');
    }
    await this.notifyDriver(driverProfileId, leg.id, leg.kind, leg.shipment.reference);
    return {
      legId: leg.id,
      shipmentReference: leg.shipment.reference,
      courierStatus: 'ASSIGNED' as const,
      assignedDriverProfileId: driverProfileId,
      assignedVehicleId: vehicleId,
    };
  }

  /** The same picture of a leg dispatchLeg reads, for the manual path. */
  private async loadForAssignment(legId: string) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: {
        id: true,
        kind: true,
        status: true,
        courierStatus: true,
        sequence: true,
        originHub: { select: { district: true } },
        shipment: {
          select: {
            id: true,
            reference: true,
            isTest: true,
            customerUserId: true,
            originDistrict: true,
            quotedTotalMinor: true,
            payment: { select: { status: true } },
            legs: { select: { sequence: true, kind: true, mode: true, status: true } },
          },
        },
      },
    });
    if (!leg) throw new NotFoundException('Shipment leg not found.');
    return leg;
  }

  /** Where the driver has to BE to start — same rule as dispatchLeg. */
  private districtFor(leg: { kind: string; originHub: { district: string } | null; shipment: { originDistrict: string | null } }): string {
    const district =
      leg.kind === 'FIRST_MILE' || leg.kind === 'DIRECT' ? leg.shipment.originDistrict : leg.originHub?.district;
    if (!district) throw new BadRequestException('This leg has no district to find a driver in.');
    return district;
  }

  /* ---------------------------------------------------------- the sweeper */

  /**
   * Release lapsed offers and roll them forward.
   *
   * Mirrors the delivery sweeper deliberately, including the ordering: the leg is
   * CLAIMED first, conditionally, because the driver may be accepting this very
   * offer between the scan and the write. If they got there first the row no
   * longer matches and the sweep backs off, rather than expiring a job somebody
   * is already driving to.
   */
  async sweepExpiredOffers(now: Date = new Date()): Promise<{ expired: number; reoffered: number }> {
    const lapsed = await this.prisma.shipmentLeg.findMany({
      where: { courierStatus: 'ASSIGNED', acceptedAt: null, offerExpiresAt: { lt: now } },
      select: { id: true, assignedDriverProfileId: true },
      take: 50,
    });

    let expired = 0;
    let reoffered = 0;
    for (const leg of lapsed) {
      const released = await this.expireOffer(leg.id, leg.assignedDriverProfileId);
      if (!released) continue;
      expired += 1;
      const out = await this.dispatchLeg(leg.id);
      if (out.result === 'OFFERED') reoffered += 1;
    }
    return { expired, reoffered };
  }

  /** Courier legs whose turn has come but which nobody has been offered yet. */
  async sweepUndispatched(): Promise<number> {
    const waiting = await this.prisma.shipmentLeg.findMany({
      where: {
        kind: { in: ['DIRECT', 'FIRST_MILE', 'LAST_MILE'] },
        status: 'READY',
        assignedDriverProfileId: null,
        dispatchExhaustedAt: null,
        OR: [{ courierStatus: null }, { courierStatus: 'PENDING_ASSIGNMENT' }, { courierStatus: 'DRIVER_DECLINED' }],
      },
      select: { id: true },
      take: 50,
    });
    let offered = 0;
    for (const leg of waiting) {
      if ((await this.dispatchLeg(leg.id)).result === 'OFFERED') offered += 1;
    }
    return offered;
  }

  private async expireOffer(legId: string, driverProfileId: string | null): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const cleared = await tx.shipmentLeg.updateMany({
        where: { id: legId, courierStatus: 'ASSIGNED', acceptedAt: null },
        data: {
          courierStatus: 'DRIVER_DECLINED',
          assignedDriverProfileId: null,
          assignedVehicleId: null,
          offerExpiresAt: null,
          declinedAt: new Date(),
          declineReason: 'Offer expired.',
        },
      });
      if (cleared.count === 0) return false;
      if (driverProfileId) {
        await tx.shipmentLegOffer.updateMany({
          where: { shipmentLegId: legId, driverProfileId, status: 'ACTIVE' },
          // No EXPIRED status exists, and none is needed: an offer that lapsed
          // was declined by silence. `declineReason` says which it was.
          data: { status: 'DECLINED', endedAt: new Date(), declineReason: 'Offer expired.' },
        });
      }
      await this.audit.record({ action: 'SHIPMENT_LEG_OFFER_EXPIRED', newValue: { legId, driverProfileId } }, tx);
      return true;
    });
  }

  /**
   * Out of retries. The leg stays where it is and an administrator is told — this
   * is the one case a human genuinely has to intervene, so it must not be
   * indistinguishable from "still looking".
   */
  private async markExhausted(legId: string, reference: string, offerCount: number): Promise<void> {
    const marked = await this.prisma.shipmentLeg.updateMany({
      where: { id: legId, dispatchExhaustedAt: null },
      data: { dispatchExhaustedAt: new Date(), offerExpiresAt: null },
    });
    if (marked.count === 0) return;
    await this.audit.record({ action: 'SHIPMENT_LEG_DISPATCH_EXHAUSTED', newValue: { legId, reference, offerCount } });
    await this.notifications.notifyAdmins('logistics.read', {
      type: 'SECURITY',
      category: 'ADMIN_ALERT',
      event: 'SHIPMENT_LEG_DISPATCH_EXHAUSTED',
      title: `Shipment ${reference} needs a driver`,
      body: 'Automatic dispatch ran out of drivers for a courier leg. Assign one by hand.',
      data: { legId, reference },
    });
  }

  /**
   * Has this shipment been paid for?
   *
   * A free shipment is payable-by-definition: nothing was owed, so nothing can
   * be outstanding. That also keeps journeys booked before shipment payments
   * existed dispatchable, rather than stranding them.
   */
  private async isPaidFor(shipment: { quotedTotalMinor: bigint; payment: { status: string } | null }): Promise<boolean> {
    if (shipment.quotedTotalMinor <= 0n) return true;
    const status = shipment.payment?.status;
    return status === 'AUTHORIZED' || status === 'SETTLING' || status === 'SETTLED';
  }

  private async notifyDriver(driverProfileId: string, legId: string, kind: string, reference: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { id: driverProfileId }, select: { userId: true } });
    if (!profile) return;
    const collecting = kind === 'FIRST_MILE';
    const direct = kind === 'DIRECT';
    await this.notifications.notifyUsers([profile.userId], {
      type: 'MARKETPLACE',
      category: 'DELIVERY',
      event: 'SHIPMENT_LEG_OFFERED',
      title: direct ? 'New shipping job' : collecting ? 'New shipping pickup' : 'New shipping delivery',
      body: direct
        ? `Collect a parcel and deliver it to the recipient. Shipment ${reference}.`
        : collecting
          ? `Collect a parcel and take it to the terminal. Shipment ${reference}.`
          : `Collect a parcel from the terminal and deliver it. Shipment ${reference}.`,
      data: { driverJobId: legId, jobKind: kind, reference },
    });
  }
}
