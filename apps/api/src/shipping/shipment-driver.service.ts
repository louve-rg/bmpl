import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canPerform,
  DELIVERY_PIN_MAX_ATTEMPTS,
  DELIVERY_STATUS_LABELS,
  driverJobActionLabel,
  driverViewForStatus,
  isLegActionable,
  TRANSPORT_MODE_LABELS,
  type DeliveryAction,
  type DeliveryStatus,
  type DriverJobKind,
  type LegView,
} from '@bmpl/shared';
import type { LegHandoffInput } from '@bmpl/validation';
import type { AuditAction, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from '../messaging/messaging.service';
import { ShipmentService } from './shipment.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** Everything a driver could need about their leg, in one read. */
const LEG_INCLUDE = {
  originHub: { select: { id: true, name: true, city: true, district: true, addressLine1: true, latitude: true, longitude: true, instructions: true, contactPhone: true } },
  destinationHub: { select: { id: true, name: true, city: true, district: true, addressLine1: true, latitude: true, longitude: true, instructions: true, contactPhone: true } },
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
      legs: { select: { sequence: true, kind: true, mode: true, status: true } },
    },
  },
} satisfies Prisma.ShipmentLegInclude;

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
  serialize(leg: LegWithGraph) {
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

    // Contact details stay sealed until the driver has actually taken the job.
    const addressPlace = (end: typeof senderEnd) => ({
      kind: 'ADDRESS' as const,
      name: committed ? end.name : null,
      phone: committed ? end.phone : null,
      address: committed ? end.address : null,
      area: [end.city, end.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
      instructions: committed ? end.instructions : null,
      pinnedLocation: committed && end.latitude != null && end.longitude != null
        ? { latitude: end.latitude, longitude: end.longitude }
        : null,
      navigationUrl: committed ? navUrl(end.latitude, end.longitude, end.address) : null,
    });
    const doorPlace = addressPlace(doorEnd);
    const hubPlace = hubEnd
      ? {
          // A terminal is a public place — there is nothing to protect, and a
          // driver comparing offers needs to know how far the trip is.
          kind: 'HUB' as const,
          name: hubEnd.name,
          phone: hubEnd.contactPhone,
          address: hubEnd.addressLine1,
          area: [hubEnd.city, hubEnd.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
          instructions: hubEnd.instructions,
          pinnedLocation: hubEnd.latitude != null && hubEnd.longitude != null ? { latitude: hubEnd.latitude, longitude: hubEnd.longitude } : null,
          navigationUrl: navUrl(hubEnd.latitude, hubEnd.longitude, hubEnd.name),
        }
      : null;

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
      pickup: kind === 'LAST_MILE' ? hubPlace : doorPlace,
      dropoff: kind === 'DIRECT' ? addressPlace(recipientEnd) : kind === 'FIRST_MILE' ? hubPlace : doorPlace,
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
    };
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
