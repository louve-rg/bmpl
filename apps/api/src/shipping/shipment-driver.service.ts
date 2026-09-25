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
  STORAGE_PREFIX,
  TRANSPORT_MODE_LABELS,
  type DeliveryAction,
  type DeliveryStatus,
  type DriverJobKind,
  type LegView,
} from '@bmpl/shared';
import type { LegHandoffInput, LegPickupPhotoInput } from '@bmpl/validation';
import type { AuditAction, Prisma } from '@bmpl/database';
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
      originLatitude: true, originLongitude: true, originInstructions: true,
      destinationName: true, destinationPhone: true, destinationAddress: true, destinationCity: true, destinationDistrict: true,
      destinationLatitude: true, destinationLongitude: true, destinationInstructions: true,
      // Every leg of the WHOLE shipment, hubs included — not just this driver's
      // own leg — so the map can show the real sender->hub->hub->recipient
      // journey (BMPL-190), not only the two ends of the one leg this driver
      // works. Ordered so the walk in serialize() below can trust sequence.
      legs: {
        orderBy: { sequence: 'asc' },
        select: { sequence: true, kind: true, mode: true, status: true, originHub: { select: HUB_SELECT }, destinationHub: { select: HUB_SELECT } },
      },
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

    const won = await this.prisma.$transaction(async (tx) => {
      // Conditional write, exactly as delivery acceptance does it: the sweeper
      // may be expiring this very offer between the read above and this write.
      // Re-asserting status AND ownership makes the database the arbiter.
      const claimed = await tx.shipmentLeg.updateMany({
        where: { id: legId, courierStatus: 'ASSIGNED', assignedDriverProfileId: profileId },
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
   */
  async confirmPickup(actor: Actor, legId: string) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    this.assertAction('CONFIRM_PICKUP', leg.courierStatus);
    if (!isLegActionable(leg.shipment.legs as LegView[], leg.sequence)) {
      throw new BadRequestException('The parcel has not reached this leg yet.');
    }

    await this.prisma.shipmentLeg.update({
      where: { id: legId },
      data: { courierStatus: 'PICKUP_CONFIRMED', pickedUpAt: new Date() },
    });
    // Records custody, moves the leg to IN_PROGRESS and recomputes the shipment.
    await this.shipments.startLeg(legId, { userId: actor.userId, label: 'Driver' });
    await this.audit.record({ action: 'SHIPMENT_LEG_PICKED_UP', actorId: actor.userId, newValue: { legId, reference: leg.shipment.reference } });
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
   */
  async confirmPickupPhoto(actor: Actor, legId: string, dto: LegPickupPhotoInput) {
    const { leg } = await this.ownedLeg(actor.userId, legId);
    if (leg.status === 'COMPLETED' || leg.status === 'CANCELLED') {
      throw new BadRequestException('This leg is already finished.');
    }
    const keys = await this.resolvePickupPhotoKeys(actor.userId, dto.photoKeys);
    await this.prisma.shipmentLeg.update({ where: { id: legId }, data: { handoffPhotoKeys: keys } });
    await this.audit.record({
      action: 'SHIPMENT_LEG_PICKED_UP',
      actorId: actor.userId,
      newValue: { legId, reference: leg.shipment.reference, pickupPhotoCount: keys.length },
    });
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
    await this.prisma.shipmentLeg.update({ where: { id: legId }, data: { courierStatus: to, [stamp]: new Date() } });
    await this.audit.record({ action: auditAction, actorId: actor.userId, newValue: { legId, reference: leg.shipment.reference } });
    if (to === 'ARRIVING' && (leg.kind === 'LAST_MILE' || leg.kind === 'DIRECT')) {
      await this.notifyCustomer(leg, 'Your driver is arriving.');
    }
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

  /* ------------------------------------------------------------ shaping */

  /**
   * The driver's view of one leg.
   *
   * Customer contact details are gated on acceptance, exactly as they are for a
   * delivery: a driver who was merely OFFERED the job sees the area, and nothing
   * that identifies the person at the other end. Only once they have committed
   * does the street address and phone number appear.
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
    const senderEnd = { name: s.originName, phone: s.originPhone, address: s.originAddress, city: s.originCity, district: s.originDistrict, latitude: s.originLatitude, longitude: s.originLongitude, instructions: s.originInstructions };
    const recipientEnd = { name: s.destinationName, phone: s.destinationPhone, address: s.destinationAddress, city: s.destinationCity, district: s.destinationDistrict, latitude: s.destinationLatitude, longitude: s.destinationLongitude, instructions: s.destinationInstructions };
    const collectsFromDoor = kind === 'FIRST_MILE' || kind === 'DIRECT';
    const doorEnd = collectsFromDoor ? senderEnd : recipientEnd;
    const hubEnd = kind === 'DIRECT' ? null : kind === 'FIRST_MILE' ? leg.destinationHub : leg.originHub;

    // Contact details stay sealed until the door end is REVEALED — which, for
    // this leg's own door, means this driver has committed to it. A door end
    // belonging to a DIFFERENT leg (the far end of the whole shipment, worked
    // by a different driver or not yet assigned to anyone) is never this
    // driver's to accept, so it is never revealed to them at all — always the
    // same safe area-only representation, independent of that other leg's own
    // status. This is the residential-privacy boundary from BMPL-136/BMPL-182,
    // extended to the additional stops below rather than relaxed for them.
    const addressPlace = (end: typeof senderEnd, revealed: boolean) => ({
      kind: 'ADDRESS' as const,
      name: revealed ? end.name : null,
      phone: revealed ? end.phone : null,
      address: revealed ? end.address : null,
      area: [end.city, end.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
      instructions: revealed ? end.instructions : null,
      pinnedLocation: revealed && end.latitude != null && end.longitude != null
        ? { latitude: end.latitude, longitude: end.longitude }
        : null,
      navigationUrl: revealed ? navUrl(end.latitude, end.longitude, end.address) : null,
    });
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
    const doorPlace = addressPlace(doorEnd, committed);
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
    routeStops.push(addressPlace(senderEnd, senderIsMine && committed));
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
    routeStops.push(addressPlace(recipientEnd, recipientIsMine && committed));

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
      mode: leg.mode,
      modeLabel: TRANSPORT_MODE_LABELS[leg.mode],
      addressUnlocked: committed,
      pickup: kind === 'LAST_MILE' ? hubEndPlace : doorPlace,
      dropoff: kind === 'DIRECT' ? addressPlace(recipientEnd, committed) : kind === 'FIRST_MILE' ? hubEndPlace : doorPlace,
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
      pickupPhotoUrls,
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
