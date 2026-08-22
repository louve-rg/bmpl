import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  canReorderQueueItem,
  DELIVERY_PIN_MAX_ATTEMPTS,
  DELIVERY_STATUS_LABELS,
  DRIVER_OPEN_STATUSES,
  DRIVER_VIEW_STATUSES,
  driverViewForStatus,
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  nextDriverAction,
  queueStopKind,
  recommendRoute,
  reorderBlockedReason,
  ROUTE_ESTIMATE_DISCLOSURE,
  STORAGE_PREFIX,
  type DeliveryStatus,
  type DriverDeliveryView,
  type LocationInput,
} from '@bmpl/shared';
import type { ConfirmDeliveryInput, ConfirmPickupInput, DeclineJobInput, PodConfirmInput, ReorderDriverQueueInput } from '@bmpl/validation';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../products/inventory.service';
import { MessagingService } from '../messaging/messaging.service';
import { SettlementService } from '../settlement/settlement.service';
import { DeliveryCoreService } from './delivery-core.service';
import { DispatchEngineService } from './dispatch-engine.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Rows needed to summarize a job in a list.
 *
 * Deliberately narrow. A list is read by a driver who has not necessarily
 * accepted the work yet, so it carries the destination AREA (city + district) and
 * never the customer's name, phone or street address — those stay on the job
 * detail, behind the ownership check. Coordinates are selected because the route
 * optimizer needs them, and are consumed server-side only; nothing in
 * `summarize` puts them in a response.
 */
const LIST_INCLUDE = {
  vendorOrder: {
    select: {
      orderNumber: true,
      itemCount: true,
      vendorProfile: {
        select: {
          businessName: true,
          locations: {
            orderBy: { isPrimary: 'desc' as const },
            take: 1,
            select: { city: true, district: true, latitude: true, longitude: true },
          },
        },
      },
      order: {
        select: {
          orderNumber: true,
          addresses: { select: { city: true, district: true, latitude: true, longitude: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderDeliveryInclude;

type DeliveryListRow = Prisma.OrderDeliveryGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * Driver job feed + operational transitions. A driver only ever sees/acts on
 * deliveries assigned to THEIR driver profile. Pickup/delivery are gated by a PIN
 * the driver submits (held by the vendor / recipient); attempts are rate-limited
 * and capped. Inventory is finalized exactly once at pickup confirmation.
 */
@Injectable()
export class DriverJobService {
  private readonly logger = new Logger(DriverJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly core: DeliveryCoreService,
    private readonly messaging: MessagingService,
    private readonly settlement: SettlementService,
    private readonly engine: DispatchEngineService,
  ) {}

  private async myProfileId(userId: string): Promise<string> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    return p.id;
  }

  /** Load a delivery and assert it is assigned to the calling driver. */
  private async ownedDelivery(userId: string, deliveryId: string) {
    const profileId = await this.myProfileId(userId);
    const d = await this.core.loadOrThrow(deliveryId);
    // 404 (not 403) so a driver cannot probe the existence of others' jobs.
    if (d.assignedDriverProfileId !== profileId) throw new NotFoundException('Job not found.');
    return { d, profileId };
  }

  // ---- reads -------------------------------------------------------------

  /**
   * The driver's job feed, narrowed to one of the four driver-facing views.
   *
   * The views are a PRESENTATION mapping over the existing state machine (see
   * `driverViewForStatus` in @bmpl/shared) — no status was added or reinterpreted
   * to produce them, and dispatch is untouched. `available` and `assigned` both
   * draw on ASSIGNED because that is the only status an offer has; they are split
   * on `acceptedAt`, in the database rather than in the mapper, so a driver
   * cannot be shown an offer as if it were already theirs.
   *
   * `active`/`completed` keep their existing meanings for any caller still using
   * them; the legacy sense of `active` (every open job, offers included) is
   * preserved as `open`.
   */
  async listJobs(userId: string, scope: DriverDeliveryView | 'open' | 'all' = 'open') {
    const profileId = await this.myProfileId(userId);
    const rows = await this.prisma.orderDelivery.findMany({
      where: { assignedDriverProfileId: profileId, ...scopeFilter(scope) },
      // Open work reads best oldest-first (the thing waiting longest is the thing
      // to do); history reads best newest-first.
      orderBy: scope === 'completed' ? { deliveredAt: 'desc' } : [{ driverQueuePosition: 'asc' }, { assignedAt: 'asc' }],
      take: 200,
      include: LIST_INCLUDE,
    });
    return rows.map((d) => this.summarize(d));
  }

  /** How many jobs sit in each view — drives the tab badges in one round trip. */
  async viewCounts(userId: string): Promise<Record<DriverDeliveryView, number>> {
    const profileId = await this.myProfileId(userId);
    const grouped = await this.prisma.orderDelivery.groupBy({
      by: ['status', 'acceptedAt'],
      where: {
        assignedDriverProfileId: profileId,
        status: { in: [...DRIVER_OPEN_STATUSES, 'DELIVERED'] as DeliveryStatus[] as never },
      },
      _count: { _all: true },
    });
    const counts: Record<DriverDeliveryView, number> = { available: 0, assigned: 0, active: 0, completed: 0 };
    for (const row of grouped) {
      const view = driverViewForStatus(row.status as DeliveryStatus, row.acceptedAt);
      if (view) counts[view] += row._count._all;
    }
    return counts;
  }

  async getJob(userId: string, deliveryId: string) {
    const { d } = await this.ownedDelivery(userId, deliveryId);
    return this.core.serialize(d, 'DRIVER');
  }

  // ---- queue + route recommendation --------------------------------------

  /**
   * The driver's actionable queue, in their order, with a recommended order
   * alongside it.
   *
   * Two orderings are returned rather than one: `position` is what the driver
   * chose (or, absent a choice, arrival order), `recommendedPosition` is what the
   * route optimizer suggests. Overwriting the driver's sequence with the
   * computed one would be the platform quietly disagreeing with the person in
   * the vehicle; showing both lets them take the suggestion or ignore it.
   *
   * Only ONE stop per delivery is fed to the optimizer — the store while the
   * goods are still there, the customer once they have been collected. That is
   * what makes the recommendation lifecycle-safe: a drop-off is not a candidate
   * stop until its own pickup has actually happened, so no ordering can put it
   * first. Coordinates are used server-side and never returned.
   */
  async queue(userId: string) {
    const profileId = await this.myProfileId(userId);
    const [rows, profile] = await Promise.all([
      this.prisma.orderDelivery.findMany({
        where: { assignedDriverProfileId: profileId, status: { in: DRIVER_OPEN_STATUSES as DeliveryStatus[] as never } },
        orderBy: [{ driverQueuePosition: 'asc' }, { assignedAt: 'asc' }],
        take: 50,
        include: LIST_INCLUDE,
      }),
      this.prisma.driverProfile.findUnique({ where: { id: profileId }, select: { homeDistrict: true } }),
    ]);

    // Unaccepted offers are shown but not routed: the driver has not taken the
    // job, so planning a route around it would be planning around work that may
    // belong to someone else in ninety seconds.
    const routable = rows.filter((d) => canReorderQueueItem(d.status, d.acceptedAt));
    const route = recommendRoute(
      routable.map((d) => ({
        id: d.id,
        location: this.stopLocation(d),
        manualPosition: d.driverQueuePosition,
      })),
      // BML has no live driver GPS. The home district is the best legitimate
      // proxy for a starting point, and it is the driver's own data.
      profile?.homeDistrict ? { district: profile.homeDistrict } : null,
    );
    const legByDelivery = new Map(route.legs.map((l) => [l.id, l]));

    const items = rows.map((d, i) => {
      const leg = legByDelivery.get(d.id);
      const stopKind = queueStopKind(d.status);
      const pickup = d.vendorOrder.vendorProfile.locations[0] ?? null;
      const dropoff = d.vendorOrder.order.addresses[0] ?? null;
      return {
        ...this.summarize(d),
        position: i + 1,
        recommendedPosition: leg?.position ?? null,
        // What the driver is heading to right now, and roughly how far it is.
        stopKind,
        stopArea: stopKind === 'PICKUP' ? areaLabel(pickup) : areaLabel(dropoff),
        legDistanceKm: leg?.legDistanceKm ?? null,
        legMinutes: leg?.legMinutes ?? null,
        estimatePrecision: leg?.precision ?? 'UNKNOWN',
        nextAction: nextDriverAction(d.status, d.acceptedAt),
        canReorder: canReorderQueueItem(d.status, d.acceptedAt),
        reorderBlockedReason: reorderBlockedReason(d.status, d.acceptedAt),
      };
    });

    return {
      items,
      route: {
        totalDistanceKm: route.totalDistanceKm,
        totalMinutes: route.totalMinutes,
        precision: route.precision,
        // Never presented as a live ETA — there is no traffic data behind it.
        disclosure: ROUTE_ESTIMATE_DISCLOSURE[route.precision],
        // The recommendation as an ordered list of delivery ids, so the UI can
        // offer "use this order" as one action.
        recommendedOrder: route.legs.map((l) => l.id),
      },
      // True when the driver's order already matches the recommendation — the UI
      // uses it to hide the "use recommended order" action rather than offering
      // a button that would change nothing.
      followsRecommendation: items
        .filter((i) => i.recommendedPosition != null)
        .every((i, index) => i.recommendedPosition === index + 1),
    };
  }

  /**
   * Persist the driver's own queue order.
   *
   * This writes ONE column, `driverQueuePosition`, and touches nothing else. It
   * cannot reassign a delivery, change a status, skip a pickup or affect
   * settlement — every update re-asserts `assignedDriverProfileId` in its WHERE
   * clause, so an id belonging to another driver matches no row and is reported
   * rather than silently applied. Jobs the lifecycle pins in place (an unaccepted
   * offer, a delivery being handed over) are rejected outright.
   */
  async reorderQueue(actor: Actor, dto: ReorderDriverQueueInput) {
    const profileId = await this.myProfileId(actor.userId);
    const ids = dto.deliveryIds;

    // Load the caller's own open deliveries and validate the request against
    // them. Anything not in this set is either someone else's or not orderable.
    const owned = await this.prisma.orderDelivery.findMany({
      where: { assignedDriverProfileId: profileId, status: { in: DRIVER_OPEN_STATUSES as DeliveryStatus[] as never } },
      select: { id: true, status: true, acceptedAt: true },
    });
    const byId = new Map(owned.map((d) => [d.id, d]));

    for (const id of ids) {
      const row = byId.get(id);
      // 404 rather than 403, consistent with ownedDelivery: a driver must not be
      // able to probe which delivery ids exist by watching the error change.
      if (!row) throw new NotFoundException('One of those deliveries is not in your queue.');
      if (!canReorderQueueItem(row.status, row.acceptedAt)) {
        throw new BadRequestException(reorderBlockedReason(row.status, row.acceptedAt) ?? 'That delivery cannot be reordered.');
      }
    }

    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.orderDelivery.updateMany({
          // Ownership re-asserted in the write itself, not merely checked above:
          // between the read and here an admin could have reassigned the job, and
          // stamping a position onto another driver's delivery — even a harmless
          // one — is a write we have no business making.
          where: { id, assignedDriverProfileId: profileId },
          data: { driverQueuePosition: i + 1 },
        }),
      ),
    );

    await this.audit.record({
      action: 'DRIVER_QUEUE_REORDERED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { deliveryIds: ids },
    });

    return this.queue(actor.userId);
  }

  // ---- shaping -----------------------------------------------------------

  private summarize(d: DeliveryListRow) {
    const address = d.vendorOrder.order.addresses[0] ?? null;
    const pickup = d.vendorOrder.vendorProfile.locations[0] ?? null;
    return {
      id: d.id,
      status: d.status,
      statusLabel: DELIVERY_STATUS_LABELS[d.status],
      // The tab this row belongs under, computed once on the server so the UI
      // cannot drift from the API about what "Active" means.
      view: driverViewForStatus(d.status, d.acceptedAt),
      orderNumber: d.vendorOrder.order.orderNumber,
      vendor: d.vendorOrder.vendorProfile.businessName,
      pickupArea: areaLabel(pickup),
      itemCount: d.vendorOrder.itemCount,
      city: address?.city ?? null,
      district: address?.district ?? null,
      feeMinor: Number(d.feeMinor),
      assignedAt: d.assignedAt,
      acceptedAt: d.acceptedAt,
      deliveredAt: d.deliveredAt,
      // Drives the accept/decline countdown on an outstanding offer.
      offerExpiresAt: d.offerExpiresAt,
      queuePosition: d.driverQueuePosition,
    };
  }

  /** The location the driver is currently heading to for this delivery. */
  private stopLocation(d: DeliveryListRow): LocationInput {
    const target =
      queueStopKind(d.status) === 'PICKUP'
        ? d.vendorOrder.vendorProfile.locations[0]
        : d.vendorOrder.order.addresses[0];
    return { latitude: target?.latitude ?? null, longitude: target?.longitude ?? null, district: target?.district ?? null };
  }

  // ---- transitions -------------------------------------------------------

  async accept(actor: Actor, deliveryId: string) {
    const { d, profileId } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === 'DRIVER_ACCEPTED') return this.core.serialize(d, 'DRIVER'); // idempotent
    this.core.assertAction('ACCEPT', d.status);

    const won = await this.prisma.$transaction(async (tx) => {
      // Conditional write, NOT an unconditional update by id. Automatic dispatch
      // introduced a second writer: the sweeper can expire this offer and hand the
      // delivery to another driver between ownedDelivery's read above and this
      // write. An unconditional update would then mark the delivery ACCEPTED while
      // it belongs to a driver who never accepted it, and this driver would get a
      // 404 on the job they were just told they had.
      //
      // Re-asserting status AND ownership inside the same statement makes the
      // database the arbiter: exactly one of the two racers updates a row.
      const claimed = await tx.orderDelivery.updateMany({
        where: { id: deliveryId, status: 'ASSIGNED', assignedDriverProfileId: profileId },
        // Clearing offerExpiresAt takes the job out of the sweeper's reach; the
        // sweeper also filters on acceptedAt, so this is belt and braces.
        data: { status: 'DRIVER_ACCEPTED', acceptedAt: new Date(), offerExpiresAt: null },
      });
      if (claimed.count === 0) return false;

      await tx.deliveryAssignment.updateMany({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'ASSIGNED', toStatus: 'DRIVER_ACCEPTED', event: 'ACCEPT', actorRole: 'DRIVER', actorUserId: actor.userId });
      await this.core.auditTransition('ACCEPT', actor.userId, deliveryId, undefined, tx);
      await this.core.notify([d.vendorOrder.order.userId, d.vendorOrder.vendorProfile.userId], { title: 'Driver accepted', body: `Your driver accepted the delivery for order ${d.vendorOrder.order.orderNumber}.`, data: { deliveryId } }, tx);
      return true;
    });

    if (!won) {
      throw new ConflictException(
        'This delivery is no longer available — the offer expired or was passed to another driver.',
      );
    }

    // Open the customer↔driver and vendor↔driver threads HERE, on acceptance —
    // not at assignment. A driver who was merely offered the job, and let it
    // expire or declined it, must not end up a permanent member of a customer's
    // conversation; automatic dispatch can offer one delivery to several drivers
    // in turn, so enrolling on assignment would accumulate them. Accepting is the
    // point the driver becomes the person the customer and vendor need to reach.
    //
    // Best-effort by design: a delivery with no chat thread is degraded, a
    // delivery that failed to accept because chat was unavailable is broken.
    await this.messaging.ensureDeliveryThreads(deliveryId, actor.userId);
    return this.getJob(actor.userId, deliveryId);
  }

  async decline(actor: Actor, deliveryId: string, dto: DeclineJobInput) {
    const { d, profileId } = await this.ownedDelivery(actor.userId, deliveryId);
    this.core.assertAction('DECLINE', d.status);
    const released = await this.prisma.$transaction(async (tx) => {
      // Same optimistic guard as accept: if the sweeper already expired this offer
      // and moved on, declining must not stamp DRIVER_DECLINED over the next
      // driver's live assignment.
      const cleared = await tx.orderDelivery.updateMany({
        where: { id: deliveryId, status: 'ASSIGNED', assignedDriverProfileId: profileId },
        // Clear the current-driver denormalization so the delivery returns to the
        // dispatch pool; assignment history is preserved on the DeliveryAssignment row.
        data: { status: 'DRIVER_DECLINED', declinedAt: new Date(), declineReason: dto.reason, assignedDriverProfileId: null, assignedVehicleId: null, offerExpiresAt: null },
      });
      if (cleared.count === 0) return false;
      await tx.deliveryAssignment.updateMany({ where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } }, data: { status: 'DECLINED', respondedAt: new Date(), endedAt: new Date(), declineReason: dto.reason } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'ASSIGNED', toStatus: 'DRIVER_DECLINED', event: 'DECLINE', actorRole: 'DRIVER', actorUserId: actor.userId, note: dto.reason });
      await this.core.auditTransition('DECLINE', actor.userId, deliveryId, { reason: dto.reason }, tx);
      // The vendor is told; the admin who assigned is told only when there WAS
      // one. Under automatic dispatch assignedByUserId is null and the engine
      // re-offers below, so there is nothing for an admin to act on.
      await this.core.notify([d.assignedByUserId, d.vendorOrder.vendorProfile.userId], { title: 'Driver declined', body: `A driver declined the delivery for order ${d.vendorOrder.order.orderNumber}. Finding another driver.`, data: { deliveryId } }, tx);
      return true;
    });

    if (!released) {
      throw new ConflictException(
        'This delivery is no longer yours — the offer expired or was passed to another driver.',
      );
    }
    // Re-offer immediately rather than waiting for the sweeper's next pass. A
    // decline is a known, instantaneous event — making the customer's order sit
    // idle for a tick because a driver was honest enough to decline promptly is
    // exactly backwards. Best-effort: the sweeper is still the safety net, so a
    // failure here delays the next offer rather than losing it.
    try {
      await this.engine.dispatch(deliveryId);
    } catch (err) {
      this.logger.warn(`re-dispatch after decline failed for ${deliveryId}: ${String(err)}`);
    }
    // Declined jobs leave the driver's active feed; return a light ack.
    return { ok: true, status: 'DRIVER_DECLINED' as const };
  }

  async confirmPickup(actor: Actor, deliveryId: string, dto: ConfirmPickupInput) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === 'PICKUP_CONFIRMED') return this.core.serialize(d, 'DRIVER'); // idempotent
    this.core.assertAction('CONFIRM_PICKUP', d.status);
    await this.verifyPinOrThrow(actor, d, 'pickup', dto.pin);

    await this.prisma.$transaction(async (tx) => {
      // Exactly-once inventory finalization guarded by inventoryFinalizedAt.
      const fresh = await tx.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { inventoryFinalizedAt: true } });
      if (!fresh.inventoryFinalizedAt) {
        for (const item of d.vendorOrder.items) {
          if (!item.productId) continue; // product deleted — nothing tracked
          const inv = await this.inventory.rowFor(item.productId, item.variantId, tx);
          if (!inv) continue; // untracked
          await this.inventory.finalizeReservation(inv.id, item.quantity, actor.userId, tx);
        }
      }
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'PICKUP_CONFIRMED',
          pickupConfirmedAt: new Date(),
          pickupVerifiedAt: new Date(),
          pickupVerificationStatus: 'VERIFIED',
          inventoryFinalizedAt: fresh.inventoryFinalizedAt ?? new Date(),
        },
      });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'DRIVER_ACCEPTED', toStatus: 'PICKUP_CONFIRMED', event: 'CONFIRM_PICKUP', actorRole: 'DRIVER', actorUserId: actor.userId });
      await this.core.auditTransition('CONFIRM_PICKUP', actor.userId, deliveryId, undefined, tx);
      if (!fresh.inventoryFinalizedAt) await this.audit.record({ action: 'INVENTORY_FULFILLED', actorId: actor.userId, newValue: { deliveryId } }, tx);
      await this.core.notify([d.vendorOrder.order.userId, d.vendorOrder.vendorProfile.userId], { title: 'Order picked up', body: `Your order ${d.vendorOrder.order.orderNumber} was picked up and is on its way soon.`, data: { deliveryId } }, tx);
    });
    await this.messaging.onDeliveryEvent(deliveryId, 'Order picked up.');
    return this.getJob(actor.userId, deliveryId);
  }

  async markInTransit(actor: Actor, deliveryId: string) {
    return this.simpleTransition(actor, deliveryId, 'IN_TRANSIT', 'IN_TRANSIT', { customer: true });
  }

  async markArriving(actor: Actor, deliveryId: string) {
    return this.simpleTransition(actor, deliveryId, 'ARRIVING', 'ARRIVING', { customer: true });
  }

  private async simpleTransition(
    actor: Actor,
    deliveryId: string,
    action: 'IN_TRANSIT' | 'ARRIVING',
    toStatus: DeliveryStatus,
    notify: { customer?: boolean },
  ) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === toStatus) return this.core.serialize(d, 'DRIVER'); // idempotent
    this.core.assertAction(action, d.status);
    const fromStatus = d.status;
    const stampField = action === 'IN_TRANSIT' ? 'inTransitAt' : 'arrivingAt';
    await this.prisma.$transaction(async (tx) => {
      await tx.orderDelivery.update({ where: { id: deliveryId }, data: { status: toStatus, [stampField]: new Date() } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus, toStatus, event: action, actorRole: 'DRIVER', actorUserId: actor.userId });
      await this.core.auditTransition(action, actor.userId, deliveryId, undefined, tx);
      if (notify.customer) {
        const body = action === 'IN_TRANSIT' ? `Your order ${d.vendorOrder.order.orderNumber} is on the way.` : `Your driver is arriving with order ${d.vendorOrder.order.orderNumber}.`;
        await this.core.notify([d.vendorOrder.order.userId], { title: action === 'IN_TRANSIT' ? 'On the way' : 'Arriving', body, data: { deliveryId } }, tx);
      }
    });
    return this.getJob(actor.userId, deliveryId);
  }

  async confirmDelivery(actor: Actor, deliveryId: string, dto: ConfirmDeliveryInput) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === 'DELIVERED') return this.core.serialize(d, 'DRIVER'); // idempotent
    this.core.assertAction('DELIVER', d.status);
    await this.verifyPinOrThrow(actor, d, 'delivery', dto.pin);
    const podKeys = dto.podPhotoKeys ? await this.resolvePodKeys(actor.userId, dto.podPhotoKeys) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliveryVerifiedAt: new Date(),
          deliveryVerificationStatus: 'VERIFIED',
          recipientName: dto.recipientName,
          deliveryNotes: dto.notes ?? null,
          ...(podKeys ? { podPhotoKeys: podKeys } : {}),
        },
      });
      await tx.deliveryAssignment.updateMany({ where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } }, data: { status: 'COMPLETED', endedAt: new Date() } });
      // Increment the driver's completed-deliveries counter (placeholder metric; NO money).
      if (d.assignedDriverProfileId) await tx.driverProfile.update({ where: { id: d.assignedDriverProfileId }, data: { completedDeliveries: { increment: 1 } } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'ARRIVING', toStatus: 'DELIVERED', event: 'DELIVER', actorRole: 'DRIVER', actorUserId: actor.userId, note: `Received by ${dto.recipientName}` });
      await this.core.auditTransition('DELIVER', actor.userId, deliveryId, { recipientName: dto.recipientName }, tx);
      if (podKeys?.length) await this.core.auditTransition('POD', actor.userId, deliveryId, { count: podKeys.length }, tx);
      await this.core.notify([d.vendorOrder.order.userId, d.vendorOrder.vendorProfile.userId, actor.userId], { event: 'DELIVERY_DELIVERED', title: 'Delivered', body: `Order ${d.vendorOrder.order.orderNumber} was delivered${dto.recipientName ? ` to ${dto.recipientName}` : ''}.`, data: { deliveryId } }, tx);
    });
    await this.messaging.onDeliveryEvent(deliveryId, 'Order delivered.');
    // Delivery completion triggers internal settlement (M18) — its own atomic,
    // idempotent transaction. Never blocks/reverts the delivery; a failure records
    // a settlement exception + alerts admins and preserves escrow.
    await this.settlement.settleVendorOrder(d.vendorOrder.id, actor.userId);
    return this.getJob(actor.userId, deliveryId);
  }

  // ---- proof of delivery -------------------------------------------------

  /** @deprecated Prefer {@link uploadPod} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignPod(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.deliveryProof(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  /** Server-side proof-of-delivery photo upload (browser → API → private storage). */
  async uploadPod(userId: string, buffer: Buffer | undefined, fileName?: string) {
    return this.ingest.image(buffer, STORAGE_PREFIX.deliveryProof(userId), 'private', {
      fileName,
      fallbackName: 'proof',
    });
  }

  /** Attach POD photos (uploaded via presign or upload) to an owned, not-yet-delivered job. */
  async confirmPod(actor: Actor, deliveryId: string, dto: PodConfirmInput) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === 'DELIVERED' || d.status === 'CANCELLED') throw new BadRequestException('Delivery is already completed.');
    const keys = await this.resolvePodKeys(actor.userId, dto.photoKeys);
    await this.prisma.orderDelivery.update({ where: { id: deliveryId }, data: { podPhotoKeys: keys } });
    await this.core.auditTransition('POD', actor.userId, deliveryId, { count: keys.length });
    await this.core.notify([d.vendorOrder.order.userId], { title: 'Proof of delivery added', body: `Proof of delivery is available for order ${d.vendorOrder.order.orderNumber}.`, data: { deliveryId } });
    return this.getJob(actor.userId, deliveryId);
  }

  private async resolvePodKeys(userId: string, keys: string[]): Promise<string[]> {
    const namespace = STORAGE_PREFIX.deliveryProof(userId);
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, namespace);
      const meta = await this.storage.headObject(key, 'private');
      if (!meta) throw new BadRequestException('An uploaded proof photo could not be found in storage.');
      if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Unsupported image type.');
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('A proof photo exceeds the maximum allowed size.');
    }
    return keys;
  }

  // ---- PIN verification (rate-limited + attempt-capped) ------------------

  private async verifyPinOrThrow(actor: Actor, d: { id: string }, kind: 'pickup' | 'delivery', submitted: string) {
    // Re-read the sensitive PIN fields (not carried on the shared graph).
    const row = await this.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: d.id },
      select: { pickupPin: true, pickupPinAttempts: true, pickupVerificationStatus: true, deliveryPin: true, deliveryPinAttempts: true, deliveryVerificationStatus: true },
    });
    const pin = kind === 'pickup' ? row.pickupPin : row.deliveryPin;
    const attempts = kind === 'pickup' ? row.pickupPinAttempts : row.deliveryPinAttempts;
    const status = kind === 'pickup' ? row.pickupVerificationStatus : row.deliveryVerificationStatus;
    if (status === 'VERIFIED' || status === 'OVERRIDDEN') return; // already satisfied
    if (!pin) throw new BadRequestException('No verification code is set for this delivery.');
    if (attempts >= DELIVERY_PIN_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts. Ask an admin to verify this delivery.');
    }
    const ok = timingSafeEqualStr(submitted, pin);
    if (!ok) {
      const nextAttempts = attempts + 1;
      const locked = nextAttempts >= DELIVERY_PIN_MAX_ATTEMPTS;
      await this.prisma.orderDelivery.update({
        where: { id: d.id },
        data: kind === 'pickup'
          ? { pickupPinAttempts: nextAttempts, ...(locked ? { pickupVerificationStatus: 'FAILED' } : {}) }
          : { deliveryPinAttempts: nextAttempts, ...(locked ? { deliveryVerificationStatus: 'FAILED' } : {}) },
      });
      await this.audit.record({ action: kind === 'pickup' ? 'DELIVERY_PICKUP_PIN_FAILED' : 'DELIVERY_DELIVERY_PIN_FAILED', actorId: actor.userId, newValue: { deliveryId: d.id, attempts: nextAttempts } });
      // A verification lock is an operational exception → alert dispatch admins (M16).
      if (locked) {
        await this.core.notifyAdmins('deliveries.read', {
          category: 'SECURITY',
          event: 'ADMIN_FAILED_DELIVERY',
          title: 'Delivery verification locked',
          body: `A ${kind} code for a delivery locked after ${nextAttempts} failed attempts and needs admin verification.`,
          data: { deliveryId: d.id, kind },
        });
      }
      throw new BadRequestException(locked ? 'Incorrect code. This delivery is now locked; ask an admin to verify.' : 'Incorrect code. Please try again.');
    }
  }
}

/**
 * The status filter for a driver-facing view.
 *
 * `available` and `assigned` are the interesting pair: both narrow to statuses
 * from DRIVER_VIEW_STATUSES, then split on `acceptedAt` IN THE QUERY. Doing the
 * split in SQL rather than in a post-filter is what guarantees a driver's
 * "Assigned" tab can never contain an offer they have not taken.
 */
function scopeFilter(scope: DriverDeliveryView | 'open' | 'all'): Prisma.OrderDeliveryWhereInput {
  switch (scope) {
    case 'available':
      return { status: 'ASSIGNED', acceptedAt: null };
    case 'assigned':
      return {
        OR: [
          { status: 'ASSIGNED', acceptedAt: { not: null } },
          { status: 'DRIVER_ACCEPTED' },
        ],
      };
    case 'active':
    case 'completed':
      return { status: { in: DRIVER_VIEW_STATUSES[scope] as DeliveryStatus[] as never } };
    case 'open':
      return { status: { in: DRIVER_OPEN_STATUSES as DeliveryStatus[] as never } };
    default:
      return {};
  }
}

/** "City, District" for a stored location, or null. Area only — never a street. */
function areaLabel(loc: { city?: string | null; district?: string | null } | null | undefined): string | null {
  if (!loc) return null;
  const district = loc.district ? loc.district.replace(/_/g, ' ') : null;
  return [loc.city, district].filter(Boolean).join(', ') || null;
}

/** Constant-time string comparison to avoid PIN timing leaks. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
