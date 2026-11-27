import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canPerform,
  DELIVERY_STATUS_LABELS,
  DRIVER_JOB_KIND_LABELS,
  isLegActionable,
  type DeliveryStatus,
  type DriverJobKind,
  type DriverJobPlace,
  type DriverJobSummary,
  type LegView,
} from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverService } from '../driver/driver.service';
import { DispatchEngineService } from './dispatch-engine.service';
import { isShipmentPaidForDispatch } from './dispatch-rules';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * EDW-P3: what the server has decided about a job automatic dispatch gave up
 * on, for the one driver asking.
 *
 * The client never recomputes any of this. `inAvailableJobs` is the server's
 * answer to "does this belong in this driver's Available Jobs", not a hint the
 * UI is free to re-derive — the whole defect this card exists to fix was a
 * distinction that only existed in presentation.
 */
export interface UnclaimedJobClaimInfo {
  /** When automatic dispatch ran out of drivers and stopped trying. */
  dispatchExhaustedAt: Date;
  /**
   * This driver was offered this job and explicitly passed on it. They can
   * still claim it — Edward's ruling is that a driver who passed may
   * reconsider — it just no longer appears in their Available Jobs.
   */
  youPassed: boolean;
  /**
   * Whether this job is in this driver's Available Jobs as well as their
   * Unclaimed Jobs. False only for a job they explicitly passed on.
   */
  inAvailableJobs: boolean;
  /**
   * POST here, with no body, to take the job.
   *
   * Root-relative and WITHOUT the `/api` prefix — the exact form the web
   * client's own helper takes (`api.post('/driver/jobs/…/claim')`), so the
   * client can post it verbatim instead of branching on `kind` to rebuild it.
   * The leading slash is load-bearing: the helper joins it onto its base.
   */
  claimPath: string;
}

/** A claimable job in the same vocabulary the driver's other lists speak. */
export type UnclaimedJob = DriverJobSummary & { claim: UnclaimedJobClaimInfo };

/**
 * Only what a list needs, and nothing a driver who has not taken the job
 * should see. Deliberately narrower than the feed's own includes: this pool is
 * visible to EVERY eligible driver at once, which is exactly the "shared
 * board" the shipment-leg feed's address-at-offer-time ruling (SHIP-B) was
 * explicitly NOT about — so no street address, no coordinates, no customer or
 * recipient name, no phone. Town and district only, the same discipline the
 * original claim-fallback list (MDF-18) already applied.
 */
const POOL_DELIVERY_INCLUDE = {
  vendorOrder: {
    select: {
      orderNumber: true,
      itemCount: true,
      vendorProfile: {
        select: {
          businessName: true,
          locations: { orderBy: { isPrimary: 'desc' as const }, take: 1, select: { city: true, district: true } },
        },
      },
      order: {
        select: { orderNumber: true, userId: true, isTest: true, addresses: { select: { city: true, district: true } } },
      },
    },
  },
} satisfies Prisma.OrderDeliveryInclude;

const POOL_LEG_INCLUDE = {
  originHub: { select: { name: true, city: true, district: true } },
  destinationHub: { select: { name: true, city: true, district: true } },
  shipment: {
    select: {
      id: true,
      reference: true,
      isTest: true,
      customerUserId: true,
      pieces: true,
      description: true,
      originCity: true,
      originDistrict: true,
      destinationCity: true,
      destinationDistrict: true,
      quotedTotalMinor: true,
      payment: { select: { status: true } },
      legs: { select: { sequence: true, kind: true, mode: true, status: true } },
    },
  },
} satisfies Prisma.ShipmentLegInclude;

type PoolDeliveryRow = Prisma.OrderDeliveryGetPayload<{ include: typeof POOL_DELIVERY_INCLUDE }>;
type PoolLegRow = Prisma.ShipmentLegGetPayload<{ include: typeof POOL_LEG_INCLUDE }>;

/** Bounded per call, the same bound the original claim-fallback list used. */
const POOL_TAKE = 50;

function areaOf(v: { city?: string | null; district?: string | null } | null | undefined): string | null {
  if (!v) return null;
  return [v.city, v.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null;
}

/** An area-only end of a job. Nothing here identifies or locates a person. */
function place(kind: 'ADDRESS' | 'HUB', name: string | null, v: { city?: string | null; district?: string | null } | null): DriverJobPlace {
  return { kind, name, area: areaOf(v), address: null, phone: null, pinnedLocation: null, navigationUrl: null };
}

/**
 * EDW-P3. The one place that answers, for both dispatch surfaces, "which jobs
 * that automatic dispatch has given up on may THIS driver see, and did they
 * already pass on them".
 *
 * WHY THIS EXISTS AS ONE SERVICE. Edward's requirement is a four-row matrix
 * over a driver's two lists:
 *
 *   explicit pass                  -> Unclaimed only, still claimable
 *   offer expired / never answered -> Available AND Unclaimed, claimable
 *   another driver took it         -> neither
 *   no longer eligible             -> neither
 *
 * Both lists are therefore the same pool, differing by exactly one predicate,
 * and that predicate is a stored fact (`DriverOfferResolution`), not a
 * presentation choice. Computing the pool in one place and deriving both lists
 * from it is what stops Available and Unclaimed disagreeing about which jobs
 * exist, which is the shape of defect this repository has hit before.
 *
 * WHY IT LIVES UNDER `dispatch/` AND READS `shipmentLeg` DIRECTLY.
 * `ShippingModule` already imports `DispatchModule`, so a dispatch-side
 * service cannot inject a shipping-side one without making the two modules
 * circular. `DriverJobFeedService` already reads `shipmentLeg` from here for
 * exactly that reason, and this follows it: one driver, one queue, both kinds,
 * read from the dispatch side.
 */
@Injectable()
export class UnclaimedJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly drivers: DriverService,
    private readonly engine: DispatchEngineService,
  ) {}

  private async myProfileId(userId: string): Promise<string> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    return p.id;
  }

  /**
   * Unclaimed Jobs: every job automatic dispatch has exhausted that this
   * driver is still eligible for — including the ones they explicitly passed
   * on, each flagged as such.
   */
  async unclaimed(userId: string): Promise<UnclaimedJob[]> {
    return (await this.pool(userId)).jobs;
  }

  /**
   * The share of the exhausted pool that belongs in this driver's Available
   * Jobs: everything except what they explicitly passed on.
   *
   * An expired offer, an offer they never saw, and a job they were never
   * offered at all are all in here. None of those is a decision, so none of
   * them removes the job from the list a driver works from.
   */
  async availableFromPool(userId: string): Promise<UnclaimedJob[]> {
    return (await this.pool(userId)).jobs.filter((j) => j.claim.inAvailableJobs);
  }

  /** How many of the above there are, for the Available tab badge. */
  async availableFromPoolCount(userId: string): Promise<number> {
    return (await this.availableFromPool(userId)).length;
  }

  // ---- the pool -------------------------------------------------------------

  /**
   * Both kinds, filtered to this driver, in one pass.
   *
   * Eligibility is evaluated per job, at read time, by the same
   * `DriverService.assignmentEligibility` authority every assignment path
   * funnels through — vehicle approval, account approval, district/city
   * coverage and the simulation boundary included. A driver who has stopped
   * being eligible drops out of BOTH lists on their next read, with no state
   * to clean up.
   */
  private async pool(userId: string): Promise<{ profileId: string; jobs: UnclaimedJob[] }> {
    const profileId = await this.myProfileId(userId);

    const [deliveries, legs] = await Promise.all([
      this.prisma.orderDelivery.findMany({
        where: this.exhaustedDeliveriesWhere(userId),
        orderBy: { dispatchExhaustedAt: 'asc' },
        take: POOL_TAKE,
        include: POOL_DELIVERY_INCLUDE,
      }),
      this.prisma.shipmentLeg.findMany({
        where: this.exhaustedLegsWhere(userId),
        orderBy: { dispatchExhaustedAt: 'asc' },
        take: POOL_TAKE,
        include: POOL_LEG_INCLUDE,
      }),
    ]);
    if (deliveries.length === 0 && legs.length === 0) return { profileId, jobs: [] };

    // The same per-driver concurrent-job cap the engine's own ranker enforces
    // (DispatchSettings.maxConcurrentPerDriver), counted across BOTH kinds —
    // otherwise a driver could pull manually past a limit automatic dispatch
    // would never have offered them. Checked once, not per job. At the cap,
    // both lists are empty rather than full of jobs every claim would refuse.
    const settings = await this.engine.settings();
    if ((await this.drivers.activeJobCount(profileId)) >= settings.maxConcurrentPerDriver) {
      return { profileId, jobs: [] };
    }

    const [passedDeliveries, passedLegs] = await Promise.all([
      this.explicitlyPassedDeliveryIds(profileId, deliveries.map((d) => d.id)),
      this.explicitlyPassedLegIds(profileId, legs.map((l) => l.id)),
    ]);

    const jobs: UnclaimedJob[] = [];
    for (const d of deliveries) {
      const district = d.vendorOrder.order.addresses[0]?.district;
      if (!district) continue; // nobody can be a legitimate candidate without one
      const e = await this.drivers.assignmentEligibility(profileId, district, undefined, {
        isTestDelivery: d.vendorOrder.order.isTest,
        city: d.vendorOrder.order.addresses[0]?.city ?? null,
      });
      if (!e.eligible) continue;
      jobs.push(this.fromPoolDelivery(d, passedDeliveries.has(d.id)));
    }
    for (const l of legs) {
      // THE payment invariant, the same one `dispatchLeg` applies before it
      // ever offers a leg (`dispatch-rules.ts`). A claim is another way to
      // become the driver for a leg, so it answers to the same rule.
      if (!isShipmentPaidForDispatch(l.shipment)) continue;
      // And the same ordering invariant: a last-mile leg whose line-haul is
      // still in the air is not a job yet, however it is reached.
      if (!isLegActionable(l.shipment.legs as LegView[], l.sequence)) continue;
      const district = this.legDistrict(l);
      if (!district) continue;
      const e = await this.drivers.assignmentEligibility(profileId, district, undefined, {
        isTestDelivery: l.shipment.isTest,
        city: this.legCity(l),
      });
      if (!e.eligible) continue;
      jobs.push(this.fromPoolLeg(l, passedLegs.has(l.id)));
    }
    // Longest-waiting first, across both kinds — the same fairness rule the
    // dispatch sweeps use, and deliberately not ordered by job kind: a parcel
    // is not more urgent than a marketplace delivery.
    return {
      profileId,
      jobs: jobs.sort(
        (a, b) => new Date(a.claim.dispatchExhaustedAt).getTime() - new Date(b.claim.dispatchExhaustedAt).getTime(),
      ),
    };
  }

  /**
   * Deliveries automatic dispatch has given up on and nobody holds.
   *
   * `assignedDriverProfileId: null` plus the two open statuses is what makes
   * "another driver already took it" drop out of both lists with no extra
   * check: the instant a claim or an assignment lands, the delivery is
   * ASSIGNED to somebody and no longer matches.
   */
  private exhaustedDeliveriesWhere(userId: string): Prisma.OrderDeliveryWhereInput {
    return {
      status: { in: ['PENDING_ASSIGNMENT', 'DRIVER_DECLINED'] },
      dispatchExhaustedAt: { not: null },
      assignedDriverProfileId: null,
      // A driver never couriers their own order — matched on the underlying
      // user id, not the active role, because the same person may hold both.
      vendorOrder: { order: { userId: { not: userId } } },
    };
  }

  /** The courier-leg mirror, including the sender's own-parcel exclusion. */
  private exhaustedLegsWhere(userId: string): Prisma.ShipmentLegWhereInput {
    return {
      kind: { in: ['DIRECT', 'FIRST_MILE', 'LAST_MILE'] },
      status: 'READY',
      assignedDriverProfileId: null,
      dispatchExhaustedAt: { not: null },
      OR: [{ courierStatus: null }, { courierStatus: 'PENDING_ASSIGNMENT' }, { courierStatus: 'DRIVER_DECLINED' }],
      shipment: { customerUserId: { not: userId } },
    };
  }

  /**
   * EDW-P3, the whole point: which of these jobs did this driver actually
   * refuse.
   *
   * Reads `resolution`, not `status` and not `respondedAt`. A DECLINED row
   * with no `resolution` is a historical row whose evidence could not
   * establish which case it was (see the EDW-P3 migration) and is NOT counted
   * as a pass — "not established" must never exclude a driver from work.
   */
  private async explicitlyPassedDeliveryIds(profileId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.deliveryAssignment.findMany({
      where: { driverProfileId: profileId, orderDeliveryId: { in: ids }, resolution: 'DECLINED_BY_DRIVER' },
      select: { orderDeliveryId: true },
      distinct: ['orderDeliveryId'],
    });
    return new Set(rows.map((r) => r.orderDeliveryId));
  }

  private async explicitlyPassedLegIds(profileId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.shipmentLegOffer.findMany({
      where: { driverProfileId: profileId, shipmentLegId: { in: ids }, resolution: 'DECLINED_BY_DRIVER' },
      select: { shipmentLegId: true },
      distinct: ['shipmentLegId'],
    });
    return new Set(rows.map((r) => r.shipmentLegId));
  }

  // ---- claiming -------------------------------------------------------------

  /**
   * A driver takes a courier leg automatic dispatch has already given up on.
   *
   * The courier-leg half of MDF-18's claim fallback, which existed for
   * marketplace deliveries only — the single largest difference between the
   * two dispatch surfaces this card found. Deliberately the same shape as
   * `DriverJobService.claim`: every guard re-asserted inside the write, so of
   * a concurrent claim, a fresh automatic offer, or an administrator's
   * assignment racing this one, exactly one writer's WHERE still matches when
   * it executes and the losers are told the job moved on.
   *
   * `dispatchExhaustedAt` is deliberately NOT cleared, matching the delivery
   * claim: if this driver later declines, the leg returns to the pool and is
   * claimable again, rather than silently becoming invisible to everyone.
   */
  async claimLeg(actor: Actor, legId: string) {
    const profileId = await this.myProfileId(actor.userId);
    const leg = await this.prisma.shipmentLeg.findUnique({ where: { id: legId }, include: POOL_LEG_INCLUDE });
    if (!leg) throw new NotFoundException('Job not found.');
    // 404, not 403 — to this driver, as a driver, their own parcel's leg
    // simply does not exist. Same reasoning as the delivery claim's own
    // existence guard (SHIP-CLAIM-ROUTE-EXISTENCE-LEAK).
    if (leg.shipment.customerUserId === actor.userId) throw new NotFoundException('Job not found.');
    if (leg.kind === 'LINE_HAUL') throw new NotFoundException('Job not found.');
    const courierStatus = (leg.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus;
    // The shared allow-list, not a hand-written status check — see
    // apps/api/CLAUDE.md §6. A leg in any other state was never claimable by
    // ANY driver, so its existence is not this driver's business either.
    if (!canPerform('CLAIM', courierStatus)) throw new NotFoundException('Job not found.');
    if (leg.status !== 'READY') throw new BadRequestException('This leg is not ready for a driver yet.');
    if (leg.assignedDriverProfileId) throw new ConflictException('This job already has a driver.');
    if (!leg.dispatchExhaustedAt) {
      throw new BadRequestException('Automatic dispatch has not given up on this leg yet.');
    }
    if (!isShipmentPaidForDispatch(leg.shipment)) {
      throw new BadRequestException('This shipment has not been paid for.');
    }
    if (!isLegActionable(leg.shipment.legs as LegView[], leg.sequence)) {
      throw new BadRequestException('The parcel has not reached this leg yet.');
    }

    const district = this.legDistrict(leg);
    if (!district) throw new BadRequestException('This leg has no district to start from; cannot claim.');
    const e = await this.drivers.assignmentEligibility(profileId, district, undefined, {
      isTestDelivery: leg.shipment.isTest,
      city: this.legCity(leg),
    });
    if (!e.eligible) throw new BadRequestException(`You are not eligible for this leg: ${e.reasons.join('; ')}.`);
    const vehicle = e.usableVehicles.find((v) => v.isPrimary) ?? e.usableVehicles[0];
    if (!vehicle) throw new BadRequestException('You need an approved, active vehicle before you can claim a job.');

    const settings = await this.engine.settings();
    if ((await this.drivers.activeJobCount(profileId)) >= settings.maxConcurrentPerDriver) {
      throw new BadRequestException('You already have the maximum number of active jobs.');
    }

    const won = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.shipmentLeg.updateMany({
        where: {
          id: legId,
          // Re-asserts the exact state this call read, not a literal: the
          // null-vs-PENDING_ASSIGNMENT distinction is real in this column.
          courierStatus: leg.courierStatus ?? null,
          status: 'READY',
          assignedDriverProfileId: null,
          dispatchExhaustedAt: { not: null },
        },
        data: {
          courierStatus: 'ASSIGNED',
          assignedDriverProfileId: profileId,
          assignedVehicleId: vehicle.id,
          assignedAt: new Date(),
          // A claim does not lapse: the offer sweeper only expires rows that
          // carry an offerExpiresAt, exactly as an admin assignment never
          // times out.
          offerExpiresAt: null,
          acceptedAt: null,
          declinedAt: null,
          declineReason: null,
        },
      });
      if (claimed.count === 0) return false;
      // Append-only history, committed with the assignment or not at all — an
      // offer the leg remembers but the history does not would let the same
      // driver be asked twice.
      await tx.shipmentLegOffer.create({
        data: { shipmentLegId: legId, driverProfileId: profileId, vehicleId: vehicle.id, status: 'ACTIVE' },
      });
      // Reuses the existing assignment action with `manner: 'CLAIM'` rather
      // than adding an audit enum value: actorId is the claiming driver and
      // no administrator is named, which is exactly how the delivery side
      // distinguishes a claim from an admin assignment.
      await this.audit.record(
        {
          action: 'SHIPMENT_LEG_DRIVER_ASSIGNED',
          actorId: actor.userId,
          newValue: {
            legId,
            shipmentId: leg.shipment.id,
            reference: leg.shipment.reference,
            driverProfileId: profileId,
            vehicleId: vehicle.id,
            manner: 'CLAIM',
          },
        },
        tx,
      );
      return true;
    });

    if (!won) {
      throw new ConflictException('This job was just claimed or assigned — reload and try again.');
    }

    // Best-effort, outside the transaction and after the write has won: a
    // notification that fails must delay nothing and undo nothing.
    await this.notifications.notifyUsers([leg.shipment.customerUserId], {
      type: 'MARKETPLACE',
      category: 'DELIVERY',
      event: 'SHIPMENT_LEG_DRIVER_ASSIGNED',
      title: 'Driver assigned',
      body: `A driver has taken a leg of shipment ${leg.shipment.reference}.`,
      data: { legId, reference: leg.shipment.reference },
    });

    // A light ack, not the full job: the driver's own detail endpoint
    // (GET /driver/shipping-jobs/:id) is the acceptance-gated view of this
    // leg and the only place allowed to serve its addresses and contacts.
    return { ok: true as const, legId, courierStatus: 'ASSIGNED' as const };
  }

  // ---- projections ----------------------------------------------------------

  private claimInfo(dispatchExhaustedAt: Date, youPassed: boolean, claimPath: string): UnclaimedJobClaimInfo {
    return { dispatchExhaustedAt, youPassed, inAvailableJobs: !youPassed, claimPath };
  }

  private fromPoolDelivery(d: PoolDeliveryRow, youPassed: boolean): UnclaimedJob {
    const status = d.status as DeliveryStatus;
    const pickup = d.vendorOrder.vendorProfile.locations[0] ?? null;
    const dropoff = d.vendorOrder.order.addresses[0] ?? null;
    return {
      id: d.id,
      kind: 'MARKETPLACE',
      kindLabel: DRIVER_JOB_KIND_LABELS.MARKETPLACE,
      // Not `driverViewForStatus`: that maps a job's own lifecycle status to a
      // tab, and this job is in no driver's lifecycle — it is unassigned work
      // the server has decided to show. `available` is where the driver acts
      // on it, and `claim.inAvailableJobs` is what says whether this
      // particular driver sees it there.
      view: 'available',
      status,
      statusLabel: DELIVERY_STATUS_LABELS[status],
      reference: d.vendorOrder.order.orderNumber,
      pickup: place('ADDRESS', d.vendorOrder.vendorProfile.businessName, pickup),
      dropoff: place('ADDRESS', null, dropoff),
      load: `${d.vendorOrder.itemCount} ${d.vendorOrder.itemCount === 1 ? 'item' : 'items'}`,
      feeMinor: Number(d.feeMinor),
      // Nobody holds this job: there is no assignment, no acceptance and no
      // offer clock on it. Stated as null rather than omitted so the shape is
      // the same one every other driver list returns.
      assignedAt: null,
      acceptedAt: null,
      completedAt: null,
      offerExpiresAt: null,
      queuePosition: null,
      isTest: d.vendorOrder.order.isTest,
      claim: this.claimInfo(d.dispatchExhaustedAt!, youPassed, `/driver/jobs/${d.id}/claim`),
      // ---- The pre-existing claim-fallback contract, unchanged. ----
      // The driver app reads these today for the Unclaimed list; the
      // normalized fields above are ADDED beside them, never instead of them,
      // the same way DriverJobFeedService.fromDelivery keeps its own legacy
      // marketplace fields.
      ...{
        orderNumber: d.vendorOrder.order.orderNumber,
        vendor: d.vendorOrder.vendorProfile.businessName,
        itemCount: d.vendorOrder.itemCount,
        city: dropoff?.city ?? null,
        district: dropoff?.district ?? null,
        dispatchExhaustedAt: d.dispatchExhaustedAt,
      },
    };
  }

  private fromPoolLeg(l: PoolLegRow, youPassed: boolean): UnclaimedJob {
    const kind = l.kind as DriverJobKind;
    const status = (l.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus;
    const s = l.shipment;
    const pieces = s.pieces ?? 1;
    // Area only, both ends, for every leg kind. A hub is a public place and
    // keeps its name; a door end is named only on the acceptance-gated detail
    // view, never on a list every eligible driver can read.
    const senderEnd = place('ADDRESS', null, { city: s.originCity, district: s.originDistrict });
    const recipientEnd = place('ADDRESS', null, { city: s.destinationCity, district: s.destinationDistrict });
    const hubEnd = (h: { name: string | null; city: string | null; district: string | null } | null) =>
      place('HUB', h?.name ?? null, h);
    return {
      id: l.id,
      kind,
      kindLabel: DRIVER_JOB_KIND_LABELS[kind],
      view: 'available',
      status,
      statusLabel: DELIVERY_STATUS_LABELS[status],
      reference: s.reference,
      pickup: kind === 'LAST_MILE' ? hubEnd(l.originHub) : senderEnd,
      dropoff: kind === 'FIRST_MILE' ? hubEnd(l.destinationHub) : recipientEnd,
      load: s.description || `${pieces} ${pieces === 1 ? 'parcel' : 'parcels'}`,
      feeMinor: Number(l.priceMinor),
      assignedAt: null,
      acceptedAt: null,
      completedAt: null,
      offerExpiresAt: null,
      queuePosition: null,
      isTest: s.isTest,
      claim: this.claimInfo(l.dispatchExhaustedAt!, youPassed, `/driver/jobs/legs/${l.id}/claim`),
    };
  }

  /** Where the driver has to BE to start — the same rule `dispatchLeg` uses. */
  private legDistrict(l: { kind: string; originHub: { district: string } | null; shipment: { originDistrict: string | null } }): string | null {
    return (l.kind === 'FIRST_MILE' || l.kind === 'DIRECT' ? l.shipment.originDistrict : l.originHub?.district) ?? null;
  }

  /** The city half of the same location — optional, unlike the district. */
  private legCity(l: { kind: string; originHub: { city: string | null } | null; shipment: { originCity: string | null } }): string | null {
    return (l.kind === 'FIRST_MILE' || l.kind === 'DIRECT' ? l.shipment.originCity : l.originHub?.city) ?? null;
  }
}
