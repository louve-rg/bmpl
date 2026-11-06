import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canPerform,
  DELIVERY_PIN_MAX_ATTEMPTS,
  DELIVERY_STATUS_LABELS,
  driverJobActionLabel,
  driverViewForStatus,
  isAllowedProductImageMime,
  isLegActionable,
  MAX_PRODUCT_IMAGE_BYTES,
  needsFirstMile,
  STORAGE_PREFIX,
  TRANSPORT_MODE_LABELS,
  type DeliveryAction,
  type DeliveryStatus,
  type DriverJobKind,
  type LegView,
} from '@bmpl/shared';
import type { LegExceptionInput, LegHandoffInput, LegPickupInput, LegPickupPhotoInput } from '@bmpl/validation';
import type { AuditAction, LegStatus, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from '../messaging/messaging.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { ShipmentService } from './shipment.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Every courierStatus a driver may call `reportIssue` from, once they have
 * genuinely committed to the job (accepted it) — see `reportIssue`'s own
 * comment for the two shapes this covers. Positive allow-list, not "not yet
 * delivered or cancelled": the same discipline apps/api/CLAUDE.md §6 asks for
 * everywhere else in this class. `ASSIGNED` is deliberately absent — a driver
 * who has only been offered the job, not accepted it, already has `DECLINE`.
 *
 * `DRIVER_ACCEPTED` — a FAILED COLLECTION report: the driver accepted but
 * cannot get the parcel (sender unavailable, parcel not ready, wrong pickup
 * location, or another obstacle). Before this, `CONFIRM_PICKUP` was the only
 * driver-reachable edge out of `DRIVER_ACCEPTED`, so a driver stuck at a
 * locked door had no way to say so (owner's section 4, found by Dwight).
 */
const REPORTABLE_COURIER_STATUSES: readonly DeliveryStatus[] = ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'];

/** A hub end is a public place — always safe to show in full, exact coordinates included. */
const HUB_SELECT = {
  id: true, name: true, city: true, district: true, addressLine1: true, latitude: true, longitude: true, instructions: true, contactPhone: true,
} satisfies Prisma.LogisticsHubSelect;

/** Everything a driver could need about their leg, in one read. */
const LEG_INCLUDE = {
  originHub: { select: HUB_SELECT },
  destinationHub: { select: HUB_SELECT },
  shipment: {
    select: {
      id: true,
      reference: true,
      isTest: true,
      service: true,
      description: true,
      pieces: true,
      weightGrams: true,
      customerUserId: true,
      originName: true, originPhone: true, originAddress: true, originCity: true, originDistrict: true,
      originLatitude: true, originLongitude: true, originInstructions: true, originLandmark: true,
      destinationName: true, destinationPhone: true, destinationAddress: true, destinationCity: true, destinationDistrict: true,
      destinationLatitude: true, destinationLongitude: true, destinationInstructions: true, destinationLandmark: true,
      // Every leg of the WHOLE shipment, hubs included — not just this driver's
      // own leg — so the map can show the real sender->hub->hub->recipient
      // journey (BMPL-190), not only the two ends of the one leg this driver
      // works. Ordered so the walk in serialize() below can trust sequence.
      legs: {
        orderBy: { sequence: 'asc' },
        select: { sequence: true, kind: true, mode: true, status: true, originHub: { select: HUB_SELECT }, destinationHub: { select: HUB_SELECT } },
      },
      // SHIP-B: the sender/recipient windows this leg is governed by — see
      // serialize()'s own comment for which role applies to which leg kind.
      availabilityWindows: { select: { role: true, startTime: true, endTime: true } },
    },
  },
} satisfies Prisma.ShipmentLegInclude;

type HubStop = Prisma.LogisticsHubGetPayload<{ select: typeof HUB_SELECT }>;

type LegWithGraph = Prisma.ShipmentLegGetPayload<{ include: typeof LEG_INCLUDE }>;

/**
 * A driver working a shipment courier leg.
 *
 * The transitions here are the SAME transitions a delivery has, guarded by the
 * SAME state machine (`canPerform` over `DELIVERY_ACTIONS`). That is the point of
 * storing `courierStatus` as a DeliveryStatus: accept, pick up, in transit,
 * arriving and deliver already exist, are already correct, and already have
 * every edge case worked out. Reimplementing them for shipping would have
 * produced a second, subtly different driver experience.
 *
 * What differs is only what the words mean at each end. A first mile "delivers"
 * to a terminal counter; a last mile "picks up" from one. The state machine does
 * not care, and the driver is told in plain language which it is.
 */
@Injectable()
export class ShipmentDriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly shipments: ShipmentService,
    private readonly dispatch: ShipmentDispatchService,
    private readonly messaging: MessagingService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
  ) {}

  private async myProfileId(userId: string): Promise<string> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    return p.id;
  }

  /** 404 rather than 403, so a driver cannot probe for other drivers' work. */
  private async ownedLeg(userId: string, legId: string): Promise<{ leg: LegWithGraph; profileId: string }> {
    const profileId = await this.myProfileId(userId);
    const leg = await this.prisma.shipmentLeg.findUnique({ where: { id: legId }, include: LEG_INCLUDE });
    if (!leg || leg.assignedDriverProfileId !== profileId) throw new NotFoundException('Job not found.');
    // The sender never carries their own parcel. Every driver-side action on a
    // leg — reading it, accepting it, the handoff PIN, completing it — comes
    // through here, so the rule is enforced once rather than per transition.
    // Assignment already makes this unreachable; this is the second lock.
    if (leg.shipment.customerUserId === userId) throw new NotFoundException('Job not found.');
    return { leg, profileId };
  }

  async getJob(userId: string, legId: string) {
    const { leg } = await this.ownedLeg(userId, legId);
    return this.serialize(leg);
  }

  /* ----------------------------------------------------------- transitions */

  async accept(actor: Actor, legId: string) {
    const { leg, profileId } = await this.ownedLeg(actor.userId, legId);
    if (leg.courierStatus === 'DRIVER_ACCEPTED') return this.serialize(leg); // idempotent
    this.assertAction('ACCEPT', leg.courierStatus);
    this.assertNotException(leg);

    const won = await this.prisma.$transaction(async (tx) => {
      // Conditional write, exactly as delivery acceptance does it: the sweeper
      // may be expiring this very offer between the read above and this write,
      // and staff may be flagging an exception in the same window. Re-asserting
      // status, exception state AND ownership makes the database the arbiter.
      const claimed = await tx.shipmentLeg.updateMany({
        where: { id: legId, courierStatus: 'ASSIGNED', assignedDriverProfileId: profileId, status: { not: 'EXCEPTION' } },
        data: { courierStatus: 'DRIVER_ACCEPTED', acceptedAt: new Date(), offerExpiresAt: null },
      });
      if (claimed.count === 0) return false;
      await tx.shipmentLegOffer.updateMany({
        where: { shipmentLegId: legId, driverProfileId: profileId, status: 'ACTIVE' },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      await this.audit.record({ action: 'SHIPMENT_LEG_ACCEPTED', actorId: actor.userId, newValue: { legId, reference: leg.shipment.reference } }, tx);
      return true;
    });
    if (!won) {
      throw new ConflictException('This job is no longer available — the offer expired or went to another driver.');
    }

    // Opened HERE, on acceptance — not at assignment. Automatic dispatch can
    // offer one leg to several drivers in turn, and enrolling each of them would
    // accumulate strangers in a customer's conversation. Accepting is the point
    // this driver becomes the person the customer needs to reach.
    await this.messaging.ensureShipmentLegThread(legId, actor.userId);
    await this.notifyCustomer(
      leg,
      leg.kind === 'LAST_MILE' ? 'A driver is collecting your parcel for the final delivery.' : 'A driver is on the way to collect your parcel.',
    );
    return this.getJob(actor.userId, legId);
  }

  async decline(actor: Actor, legId: string, reason: string) {
    const { leg, profileId } = await this.ownedLeg(actor.userId, legId);
    this.assertAction('DECLINE', leg.courierStatus);

    const released = await this.prisma.$transaction(async (tx) => {
      const cleared = await tx.shipmentLeg.updateMany({
        where: { id: legId, courierStatus: 'ASSIGNED', assignedDriverProfileId: profileId },
        // Back to the pool. History keeps who was asked; the leg forgets, so the
        // next offer starts clean.
        data: {
          courierStatus: 'DRIVER_DECLINED',
          declinedAt: new Date(),
          declineReason: reason,
          assignedDriverProfileId: null,
          assignedVehicleId: null,
          offerExpiresAt: null,
        },
      });
      if (cleared.count === 0) return false;
      await tx.shipmentLegOffer.updateMany({
        where: { shipmentLegId: legId, driverProfileId: profileId, status: { in: ['ACTIVE', 'ACCEPTED'] } },
        data: { status: 'DECLINED', respondedAt: new Date(), endedAt: new Date(), declineReason: reason },
      });
      await this.audit.record({ action: 'SHIPMENT_LEG_DECLINED', actorId: actor.userId, reason, newValue: { legId, reference: leg.shipment.reference } }, tx);
      return true;
    });
    if (!released) throw new ConflictException('That offer has already moved on.');

    // Straight to the next driver, same as a declined delivery.
    await this.dispatch.dispatchLeg(legId);
    return { declined: true };
  }

  /**
   * The driver has the parcel.
   *
   * This is the moment the shipment leg genuinely starts moving, so it is also
   * the moment custody passes and the shipment's own status advances. Both
   * happen through the shipment layer rather than being written here — the
   * shipment owns its status derivation, and a second writer would drift.
   *
   * SHIPPING-E2E step 9: a leg that genuinely starts at a door (FIRST_MILE or
   * DIRECT, on a service that `needsFirstMile`) now ENFORCES the sender's own
   * collection code — RULING 1, owner's explicit requirement: a missing,
   * empty or malformed pin on an enforcing leg is a REJECTION, never a
   * silent pass-through. Every other leg kind/service combination never
   * enforced one (LINE_HAUL's custody is already proven by the preceding
   * leg's own handoff; a DOOR_TO_HUB service has no driver at a door at
   * all), so `dto.pin` is accepted but ignored there — the exact backward-
   * compatible shape the contract promised Oscar.
   *
   * A structurally-enforcing leg that predates this feature entirely
   * (pickupPinGrandfathered, set true only by the migration's one-time
   * default-flip for rows that already existed) is a third, narrow case:
   * exempt from ruling 1, not because the rule softened, but because it has
   * no pin and never will. It collects exactly as it did before this
   * shipped, and the exemption is recorded on the pickup audit row.
   */
  async confirmPickup(actor: Actor, legId: string, dto: LegPickupInput) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    this.assertAction('CONFIRM_PICKUP', leg.courierStatus);
    this.assertNotException(leg);
    if (!isLegActionable(leg.shipment.legs as LegView[], leg.sequence)) {
      throw new BadRequestException('The parcel has not reached this leg yet.');
    }

    // Structurally eligible for enforcement by kind + service alone — but a
    // row that predates this feature (migration-day grandfather, owner
    // ruling) is exempt even when structurally eligible: it has no pin and
    // never will, so enforcing against it would lock every shipment already
    // in flight on the day this ships into EXCEPTION, one by one. A leg
    // created BY this feature always gets a real pickupPin and is never
    // grandfathered (ShipmentService.legData()), so this exemption cannot
    // mask a genuine missing-pin defect going forward — see
    // pickupPinGrandfathered's own comment in schema.prisma.
    const structurallyEnforcesPickupPin =
      (leg.kind === 'FIRST_MILE' || leg.kind === 'DIRECT') && needsFirstMile(leg.shipment.service);
    const enforcesPickupPin = structurallyEnforcesPickupPin && !leg.pickupPinGrandfathered;
    if (enforcesPickupPin) {
      // Checked BEFORE the transition, in its own write — same shape and same
      // reasoning as completeHandoff/completeLeg's verifyLegPinOrThrow call: a
      // failed attempt recorded inside the transition's own transaction would
      // roll back when that transaction throws, and the counter would never
      // climb.
      await this.shipments.verifyPickupPin(legId, dto.pin, actor);
    }

    // Conditional, not an update by id: staff may flag the exception in the
    // same window the driver is confirming pickup. The database, not the read
    // above, is the arbiter.
    const claimed = await this.prisma.shipmentLeg.updateMany({
      where: { id: legId, courierStatus: 'DRIVER_ACCEPTED', status: { not: 'EXCEPTION' } },
      data: {
        courierStatus: 'PICKUP_CONFIRMED',
        pickedUpAt: new Date(),
        ...(enforcesPickupPin ? { pickupVerifiedAt: new Date(), pickupVerificationStatus: 'VERIFIED' } : {}),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This leg has an open exception and must be resolved by staff before it can be picked up.');
    }
    // Records custody, moves the leg to IN_PROGRESS and recomputes the shipment.
    await this.shipments.startLeg(legId, { userId: actor.userId, label: 'Driver' });
    // A photo attached before this call already recorded the pickup itself
    // (BMPL-189) — this transition still applies (courierStatus, custody,
    // notification), but the audit trail only gets one SHIPMENT_LEG_PICKED_UP
    // row per leg, whichever path wrote it first.
    if (leg.handoffPhotoKeys.length === 0) {
      await this.audit.record({
        action: 'SHIPMENT_LEG_PICKED_UP',
        actorId: actor.userId,
        newValue: {
          legId,
          reference: leg.shipment.reference,
          // Only true when a leg that would otherwise enforce a code was let
          // through on the migration-day grandfather — the reason the owner
          // asked to have on record for every leg this ever fires on.
          pickupPinGrandfathered: structurallyEnforcesPickupPin && leg.pickupPinGrandfathered,
        },
      });
    }
    await this.notifyCustomer(
      leg,
      leg.kind === 'FIRST_MILE' ? 'Your parcel has been collected.' : 'Your parcel is out for delivery.',
    );
    return this.getJob(actor.userId, legId);
  }

  /* ------------------------------------------------------- pickup photo */

  /** Server-side pickup-evidence photo upload (browser -> API -> private storage). */
  async uploadPickupPhoto(userId: string, buffer: Buffer | undefined, fileName?: string) {
    return this.ingest.image(buffer, STORAGE_PREFIX.shipmentPickupProof(userId), 'private', {
      fileName,
      fallbackName: 'pickup',
    });
  }

  /**
   * Attach pickup-evidence photos (uploaded above) to the courier's own leg.
   *
   * `ownedLeg` is the same necessary-but-not-sufficient check every other
   * driver-side write on this leg goes through (BMPL-174/187 shape): holding a
   * driver profile is necessary, but it must also be the profile THIS leg is
   * assigned to. A leg already handed over has nothing left to photograph.
   *
   * Reuses the `SHIPMENT_LEG_PICKED_UP` audit action (with a photo count in
   * `newValue`) rather than adding a new `AuditAction` enum value, which would
   * need its own migration — this card is scoped as additive-only, no schema
   * change.
   *
   * ONE ROW PER LEG (BMPL-189): this can be called any number of times — to
   * attach the first evidence, or to replace/add photos later — and it can be
   * called before OR after `confirmPickup` (test 2 in
   * shipping-pickup-photo.integration.spec.ts exercises it with no prior
   * `/pickup` call at all, so it must stand on its own as a pickup record).
   * A second call on an already-recorded leg would otherwise write a second
   * `SHIPMENT_LEG_PICKED_UP` row asserting a pickup that did not happen again.
   * The audit row is written only the first time either path (a confirmed
   * pickup, or a previously attached photo) has not yet recorded this leg's
   * pickup; every later call still updates the stored photo keys.
   */
  async confirmPickupPhoto(actor: Actor, legId: string, dto: LegPickupPhotoInput) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    if (leg.status === 'COMPLETED' || leg.status === 'CANCELLED') {
      throw new BadRequestException('This leg is already finished.');
    }
    // SHIP-M: `ownedLeg` only proves this driver is the ASSIGNEE, and
    // assignment happens at OFFER time, before acceptance — an offered,
    // uncommitted driver is still the assignee. Every other driver-side
    // mutation on this leg (accept/confirmPickup/simpleTransition/
    // completeHandoff) is gated by `assertAction`'s positive courierStatus
    // allow-list, which structurally excludes ASSIGNED for everything except
    // ACCEPT/DECLINE themselves. This endpoint had no such check at all, so
    // an offered driver could attach custody-evidence photos to a leg they
    // never committed to carrying — and since offers rotate (expiry,
    // decline), a later driver can end up holding a leg whose pickup photo
    // was taken by someone who was never its courier (BML-FW9J6WXH).
    if (leg.acceptedAt == null) {
      throw new BadRequestException('Accept the job before attaching a pickup photo.');
    }
    const alreadyRecorded = leg.pickedUpAt !== null || leg.handoffPhotoKeys.length > 0;
    const keys = await this.resolvePickupPhotoKeys(actor.userId, dto.photoKeys);
    await this.prisma.shipmentLeg.update({ where: { id: legId }, data: { handoffPhotoKeys: keys } });
    if (!alreadyRecorded) {
      await this.audit.record({
        action: 'SHIPMENT_LEG_PICKED_UP',
        actorId: actor.userId,
        newValue: { legId, reference: leg.shipment.reference, pickupPhotoCount: keys.length },
      });
    }
    return this.getJob(actor.userId, legId);
  }

  private async resolvePickupPhotoKeys(userId: string, keys: string[]): Promise<string[]> {
    const namespace = STORAGE_PREFIX.shipmentPickupProof(userId);
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, namespace);
      const meta = await this.storage.headObject(key, 'private');
      if (!meta) throw new BadRequestException('An uploaded pickup photo could not be found in storage.');
      if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Unsupported image type.');
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) {
        throw new BadRequestException('A pickup photo exceeds the maximum allowed size.');
      }
    }
    return keys;
  }

  async markInTransit(actor: Actor, legId: string) {
    return this.simpleTransition(actor, legId, 'IN_TRANSIT', 'IN_TRANSIT', 'inTransitAt', 'SHIPMENT_LEG_IN_TRANSIT');
  }

  async markArriving(actor: Actor, legId: string) {
    return this.simpleTransition(actor, legId, 'ARRIVING', 'ARRIVING', 'arrivingAt', 'SHIPMENT_LEG_ARRIVING');
  }

  private async simpleTransition(
    actor: Actor,
    legId: string,
    action: DeliveryAction,
    to: DeliveryStatus,
    stamp: 'inTransitAt' | 'arrivingAt',
    auditAction: AuditAction,
  ) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    this.assertAction(action, leg.courierStatus);
    this.assertNotException(leg);
    // Conditional, not an update by id: re-asserting the courier status just
    // read closes the same window a concurrent exception flag (or a second
    // tap of this same button) would otherwise land in.
    const claimed = await this.prisma.shipmentLeg.updateMany({
      where: { id: legId, courierStatus: leg.courierStatus, status: { not: 'EXCEPTION' } },
      data: { courierStatus: to, [stamp]: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        `This leg has an open exception or already moved on, so it cannot ${action.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }
    await this.audit.record({ action: auditAction, actorId: actor.userId, newValue: { legId, reference: leg.shipment.reference } });
    if (to === 'ARRIVING' && (leg.kind === 'LAST_MILE' || leg.kind === 'DIRECT')) {
      await this.notifyCustomer(leg, 'Your driver is arriving.');
    }
    return this.getJob(actor.userId, legId);
  }

  /**
   * The courier reports something wrong — MDF-96 (Edward requirement 10),
   * Option 2, now covering two shapes. The SAME exception gate staff already
   * use (`ShipmentService.flagException`), reached a second way rather than
   * duplicated: no new leg state, no new notification, no new audit action,
   * and — for the collection case — no new endpoint either.
   *
   *  - FAILED COLLECTION (`DRIVER_ACCEPTED`): the driver accepted the job but
   *    cannot get the parcel — sender unavailable, parcel not ready, wrong
   *    pickup location, or another obstacle. A report here is an
   *    ESCALATION, never a terminal action: it moves no money, refunds
   *    nothing and does not touch the driver's own record. It only opens the
   *    SAME hold `flagException` already gives staff, who resolve it through
   *    the existing business rules (reassignment via `resolveException`'s
   *    `RELEASE_DRIVER` or admin `REASSIGN`, rescheduling, or cancellation) —
   *    nothing new is invented here.
   *  - FAILED DELIVERY (`PICKUP_CONFIRMED`/`IN_TRANSIT`/`ARRIVING`):
   *    "attempted delivery, nobody was there" presupposes an attempt, so this
   *    stays gated to once the driver actually holds the parcel.
   *
   * `ownedLeg` is the one check every other driver-side write on this leg
   * goes through — holding a driver profile is necessary, but it must also
   * be THIS leg's assigned driver. A driver reporting an issue on someone
   * else's leg is refused (404, same as every other ownership miss here)
   * before this ever reaches the shared exception primitive.
   *
   * Positive allow-list (`REPORTABLE_COURIER_STATUSES`), same discipline as
   * every other courierStatus guard in this class — DELIVERED/CANCELLED are
   * terminal and were never going to be members of it.
   */
  async reportIssue(actor: Actor, legId: string, input: LegExceptionInput) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    const status = leg.courierStatus ?? 'PENDING_ASSIGNMENT';
    if (!REPORTABLE_COURIER_STATUSES.includes(status)) {
      throw new BadRequestException(`Cannot report an issue while the job is "${DELIVERY_STATUS_LABELS[status]}".`);
    }
    await this.shipments.flagException(legId, input, { userId: actor.userId, label: 'Driver' });
    return this.getJob(actor.userId, legId);
  }

  /**
   * The end of the leg: hand the parcel over and prove it.
   *
   * Verification is the shipment layer's `completeLeg` — the same PIN check, the
   * same five-attempt lockout, the same append-only custody write, and the same
   * release of the next leg. The driver path deliberately has no separate
   * verification of its own, because a second implementation of "is this the
   * right code" is a second thing that can be wrong.
   */
  async completeHandoff(actor: Actor, legId: string, dto: LegHandoffInput) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    this.assertAction('DELIVER', leg.courierStatus);
    this.assertNotException(leg);

    // `completeLeg` already runs through `ShipmentService.transition()`,
    // which re-reads the leg and refuses it via `isLegActionable` the moment
    // `status` is EXCEPTION, inside the same transaction as its write — this
    // check only gives the driver the specific, honest reason on the request
    // that hits the common case rather than the race window.
    const shipment = await this.shipments.completeLeg(legId, dto, { userId: actor.userId, label: dto.receivedByName });
    await this.prisma.shipmentLeg.update({
      where: { id: legId },
      data: { courierStatus: 'DELIVERED', driverQueuePosition: null },
    });

    // A completed first mile puts the parcel at the terminal; the next leg may
    // now become workable. Dispatching here rather than waiting for the sweeper
    // means the next driver hears about it in seconds, not minutes.
    await this.releaseFollowingCourierLeg(leg.shipmentId);
    return { job: await this.getJob(actor.userId, legId), shipment };
  }

  /** Offer whichever courier leg has just become workable, if any. */
  private async releaseFollowingCourierLeg(shipmentId: string) {
    const next = await this.prisma.shipmentLeg.findFirst({
      where: {
        shipmentId,
        kind: { in: ['DIRECT', 'FIRST_MILE', 'LAST_MILE'] },
        status: 'READY',
        assignedDriverProfileId: null,
      },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    if (next) await this.dispatch.dispatchLeg(next.id);
  }

  private assertAction(action: DeliveryAction, current: DeliveryStatus | null) {
    const status = current ?? 'PENDING_ASSIGNMENT';
    if (!canPerform(action, status)) {
      throw new BadRequestException(
        `Cannot ${action.toLowerCase().replace(/_/g, ' ')} a job that is "${DELIVERY_STATUS_LABELS[status]}".`,
      );
    }
  }

  /**
   * Owner ruling: an active exception blocks every forward courier
   * transition until authorized staff resolve it
   * (`ShipmentService.resolveException`) — never an automatic status, fee or
   * settlement side effect. `courierStatus` and `status` are two separate
   * columns on the same row; nothing upstream kept them in step, so each
   * transition must check `status` itself rather than inferring it from
   * `courierStatus`. This is the clear, same-request rejection; the
   * conditional write each caller makes right after is what actually closes
   * the race against staff flagging the exception a moment later.
   */
  private assertNotException(leg: { status: LegStatus; shipment: { reference: string } }) {
    if (leg.status === 'EXCEPTION') {
      throw new ConflictException(
        `Shipment ${leg.shipment.reference} has an open exception on this leg. Staff must resolve it before the job can move forward.`,
      );
    }
  }

  /* ------------------------------------------------------------ shaping */

  /**
   * The driver's view of one leg.
   *
   * SHIP-B / owner ruling (conv-7ffab9): a driver who was merely OFFERED the
   * job — not yet accepted — sees the FULL street address, coordinates,
   * access instructions and a working navigation link for this leg's own
   * door end. A driver cannot judge or reach a job they cannot locate.
   * Customer NAME and PHONE stay gated until acceptance — identity is the
   * privacy interest here, not the address. A door end belonging to a
   * DIFFERENT leg (someone else's job, or not yet assigned to anyone) is
   * never revealed to this driver at all, regardless of acceptance state —
   * only this driver's own leg gets the pre-acceptance location reveal.
   */
  async serialize(leg: LegWithGraph) {
    const s = leg.shipment;
    const kind = leg.kind as DriverJobKind;
    const committed = leg.acceptedAt != null;
    const status = (leg.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus;

    // Three shapes, one difference between them: which end is a door.
    //   FIRST_MILE  sender's door  -> terminal
    //   LAST_MILE   terminal       -> recipient's door
    //   DIRECT      sender's door  -> recipient's door   (no terminal at all)
    const senderEnd = { name: s.originName, phone: s.originPhone, address: s.originAddress, city: s.originCity, district: s.originDistrict, latitude: s.originLatitude, longitude: s.originLongitude, instructions: s.originInstructions, landmark: s.originLandmark };
    const recipientEnd = { name: s.destinationName, phone: s.destinationPhone, address: s.destinationAddress, city: s.destinationCity, district: s.destinationDistrict, latitude: s.destinationLatitude, longitude: s.destinationLongitude, instructions: s.destinationInstructions, landmark: s.destinationLandmark };
    const collectsFromDoor = kind === 'FIRST_MILE' || kind === 'DIRECT';
    const doorEnd = collectsFromDoor ? senderEnd : recipientEnd;
    const hubEnd = kind === 'DIRECT' ? null : kind === 'FIRST_MILE' ? leg.destinationHub : leg.originHub;

    // SHIP-B / owner ruling (conv-7ffab9): the pre-acceptance gate used to seal
    // the WHOLE address block — location and identity together — on the
    // theory that "committed to it" was the only safe line. The owner
    // overruled that for a door end that is this driver's OWN leg to work:
    // "do not hide what is needed to evaluate and perform the job" (location)
    // while "identity is the privacy interest" (name/phone) stays exactly as
    // sealed as before. So the two halves split: `mine` alone unlocks address,
    // instructions, landmark, coordinates and the navigation link — a driver
    // cannot judge or reach a job they cannot locate, offered or not. `mine &&
    // committed` still gates name and phone — nothing here makes a stranger's
    // identity visible to a driver who has only been offered the job, same
    // boundary as before.
    //
    // A door end belonging to a DIFFERENT leg (the far end of the whole
    // shipment, worked by a different driver or not yet assigned to anyone)
    // is never this driver's to accept, so `mine` is false for it and NOTHING
    // changes there — area-only, independent of that other leg's own status.
    // This is the residential-privacy boundary from BMPL-136/BMPL-182,
    // narrowed by the owner to cover identity alone for one's own leg, and
    // left completely intact for every other leg's stop.
    const addressPlace = (end: typeof senderEnd, mine: boolean, committed: boolean) => {
      const locationRevealed = mine;
      const contactRevealed = mine && committed;
      return {
        kind: 'ADDRESS' as const,
        name: contactRevealed ? end.name : null,
        phone: contactRevealed ? end.phone : null,
        address: locationRevealed ? end.address : null,
        area: [end.city, end.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
        instructions: locationRevealed ? end.instructions : null,
        landmark: locationRevealed ? end.landmark : null,
        pinnedLocation: locationRevealed && end.latitude != null && end.longitude != null
          ? { latitude: end.latitude, longitude: end.longitude }
          : null,
        navigationUrl: locationRevealed ? navUrl(end.latitude, end.longitude, end.address) : null,
      };
    };
    // A terminal is a public place — there is nothing to protect, and a driver
    // comparing offers (or just seeing the whole trip) needs to know how far
    // it is. Every hub end, on any leg of the shipment, uses this unconditionally.
    const hubPlace = (hub: HubStop) => ({
      kind: 'HUB' as const,
      name: hub.name,
      phone: hub.contactPhone,
      address: hub.addressLine1,
      area: [hub.city, hub.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
      instructions: hub.instructions,
      pinnedLocation: hub.latitude != null && hub.longitude != null ? { latitude: hub.latitude, longitude: hub.longitude } : null,
      navigationUrl: navUrl(hub.latitude, hub.longitude, hub.name),
    });
    const doorPlace = addressPlace(doorEnd, true, committed);
    const hubEndPlace = hubEnd ? hubPlace(hubEnd) : null;

    // The real journey (BMPL-190): every stop the system actually knows about,
    // sender door to recipient door, in order — not just this leg's own two
    // ends. Built by walking every leg of the shipment (not only this
    // driver's), collapsing a hub that borders two legs (e.g. a first mile's
    // destination and the next leg's origin) into the single stop it is.
    // Nothing here is invented: a leg with no hub (DIRECT) simply contributes
    // none, and a shipment with only a DIRECT leg stays a genuine two-stop
    // A/B journey, never padded out.
    // Whether THIS driver's own leg is the one that actually touches each
    // door — the only condition under which that door can ever be revealed.
    const senderIsMine = kind === 'FIRST_MILE' || kind === 'DIRECT';
    const recipientIsMine = kind === 'LAST_MILE' || kind === 'DIRECT';
    const routeStops: Array<ReturnType<typeof addressPlace> | ReturnType<typeof hubPlace>> = [];
    routeStops.push(addressPlace(senderEnd, senderIsMine, committed));
    let lastHubId: string | null = null;
    for (const l of s.legs) {
      if (l.originHub && l.originHub.id !== lastHubId) {
        routeStops.push(hubPlace(l.originHub));
        lastHubId = l.originHub.id;
      }
      if (l.destinationHub && l.destinationHub.id !== lastHubId) {
        routeStops.push(hubPlace(l.destinationHub));
        lastHubId = l.destinationHub.id;
      }
    }
    routeStops.push(addressPlace(recipientEnd, recipientIsMine, committed));

    const pickupPhotoUrls = await this.photoUrls(leg.handoffPhotoKeys);

    return {
      id: leg.id,
      jobKind: kind,
      isShipmentLeg: true,
      shipmentId: leg.shipmentId,
      reference: s.reference,
      isTest: s.isTest,
      sequence: leg.sequence,
      status,
      statusLabel: DELIVERY_STATUS_LABELS[status],
      view: driverViewForStatus(status, leg.acceptedAt),
      nextActionLabel: driverJobActionLabel(kind, status),
      // The leg's OWN status (PENDING/READY/IN_PROGRESS/COMPLETED/CANCELLED/
      // EXCEPTION) — a separate column from `status` above, which is this
      // leg's courierStatus. Additive: the frontend's own exception-aware
      // controls feature-detect on this field and degrade to today's
      // behaviour when it is absent, so exposing it changes nothing for an
      // older client.
      legStatus: leg.status,
      mode: leg.mode,
      modeLabel: TRANSPORT_MODE_LABELS[leg.mode],
      // `pickup`/`dropoff` are always THIS leg's own two action points, never
      // another leg's — so `mine` is always true for whichever of them is an
      // ADDRESS (a HUB end has no gate at all). Location is therefore always
      // unlocked here now; kept (rather than removed) for the existing
      // frontend, which reads it to decide whether to show its "appears once
      // you accept" hint — now correctly never, since there is nothing left
      // to unlock on this driver's own leg. `contactUnlocked` is the new,
      // narrower signal for name/phone specifically — still gated on
      // acceptance, unchanged from the old behaviour.
      addressUnlocked: true,
      contactUnlocked: committed,
      pickup: kind === 'LAST_MILE' ? hubEndPlace : doorPlace,
      dropoff: kind === 'DIRECT' ? addressPlace(recipientEnd, true, committed) : kind === 'FIRST_MILE' ? hubEndPlace : doorPlace,
      // The full known journey, sender door to recipient door, for the map
      // (BMPL-190) — separate from pickup/dropoff above, which stay exactly
      // this leg's own two action points for the driver's task text.
      routeStops,
      parcel: {
        description: s.description,
        pieces: s.pieces,
        weightGrams: s.weightGrams,
      },
      feeMinor: Number(leg.priceMinor),
      // Who the driver has to get the code FROM at the end of this leg.
      handoffCodeHeldBy: kind === 'FIRST_MILE' ? 'the terminal staff' : 'the person receiving it',
      offerExpiresAt: leg.offerExpiresAt,
      assignedAt: leg.assignedAt,
      acceptedAt: leg.acceptedAt,
      pickedUpAt: leg.pickedUpAt,
      completedAt: leg.completedAt,
      queuePosition: leg.driverQueuePosition,
      pinAttemptsRemaining: Math.max(0, DELIVERY_PIN_MAX_ATTEMPTS - leg.handoffPinAttempts),
      // SHIPPING-E2E: true only on a leg that genuinely enforces a pickup
      // code (kind FIRST_MILE/DIRECT, service needsFirstMile), has not
      // already satisfied it, and was not grandfathered in on migration day
      // — mirrors requiresPickupPin on the marketplace delivery view
      // (delivery-core.service.ts). The PIN value itself is never in this
      // payload, same rule as handoffPin.
      requiresPickupPin:
        (kind === 'FIRST_MILE' || kind === 'DIRECT') &&
        needsFirstMile(s.service) &&
        leg.pickupVerificationStatus === 'PENDING' &&
        !leg.pickupPinGrandfathered,
      pickupPhotoUrls,
      // SHIP-B: only the role(s) THIS leg's own task is governed by — a
      // FIRST_MILE/DIRECT leg collects, so only SENDER matters to it; a
      // LAST_MILE/DIRECT leg delivers, so only RECIPIENT does. Same rule
      // apps/web's AvailabilityWindows.tsx governingLeg() already applies,
      // not a new one. Shown from offer time, not gated on `committed` —
      // a time window is not personally identifying, and a driver deciding
      // whether to take the job needs to know whether they can make it
      // before committing to it.
      availabilityWindows: s.availabilityWindows
        .filter((w) => (senderIsMine && w.role === 'SENDER') || (recipientIsMine && w.role === 'RECIPIENT'))
        .map((w) => ({ role: w.role, startTime: w.startTime, endTime: w.endTime })),
    };
  }

  /** Short-lived signed URLs for stored pickup-photo keys. A dangling/deleted
   *  key is dropped rather than surfaced as an error — same as delivery POD. */
  private async photoUrls(keys: string[]): Promise<string[]> {
    const urls = await Promise.all(
      keys.map(async (k) => {
        try {
          return (await this.storage.presignDownload(k, 'private')).url;
        } catch {
          return null;
        }
      }),
    );
    return urls.filter((u): u is string => !!u);
  }

  private async notifyCustomer(leg: LegWithGraph, body: string) {
    if (!leg.shipment.customerUserId) return;
    await this.notifications.notifyUsers([leg.shipment.customerUserId], {
      type: 'MARKETPLACE',
      category: 'DELIVERY',
      event: 'SHIPMENT_COURIER',
      title: `Shipment ${leg.shipment.reference}`,
      body,
      data: { shipmentId: leg.shipmentId, reference: leg.shipment.reference },
    });
  }
}

/** A maps link the driver's phone will open. Coordinates when we have them. */
function navUrl(lat: number | null, lng: number | null, label: string | null): string | null {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  if (label) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${label}, Belize`)}`;
  return null;
}
