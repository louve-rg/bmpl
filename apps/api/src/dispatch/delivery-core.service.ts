import { randomInt } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isWithinBelize,
  mapsNavigationUrl,
  DELIVERY_ACTIONS,
  DELIVERY_PIN_LENGTH,
  DELIVERY_STATUS_LABELS,
  buildDeliveryProgress,
  canPerform,
  userInitials,
  type DeliveryAction,
  type DeliveryStatus,
} from '@bmpl/shared';
import type { AuditAction } from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { AVATAR_SELECT, publicAvatarUrl } from '../common/avatar-url';

const money = (v: bigint | null | undefined): number | null => (v == null ? null : Number(v));

/** Audience determines which fields a serialized delivery exposes. PINs are NEVER
 *  included in any general payload — they are revealed only via dedicated,
 *  permission-checked endpoints. */
export type DeliveryAudience = 'ADMIN' | 'DRIVER' | 'CUSTOMER' | 'VENDOR';

export const AUDIT_FOR_ACTION: Record<DeliveryAction, AuditAction> = {
  ASSIGN: 'DELIVERY_ASSIGNED',
  REASSIGN: 'DELIVERY_REASSIGNED',
  CANCEL: 'DELIVERY_ASSIGNMENT_CANCELLED',
  ACCEPT: 'DELIVERY_ACCEPTED',
  DECLINE: 'DELIVERY_DECLINED',
  CONFIRM_PICKUP: 'DELIVERY_PICKUP_CONFIRMED',
  IN_TRANSIT: 'DELIVERY_IN_TRANSIT',
  ARRIVING: 'DELIVERY_ARRIVING',
  DELIVER: 'DELIVERY_COMPLETED',
};

/** Full relation graph needed to serialize a delivery for any audience. */
export const DELIVERY_INCLUDE = {
  vendorOrder: {
    include: {
      vendorProfile: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          userId: true,
          locations: { orderBy: { isPrimary: 'desc' as const }, take: 1 },
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          status: true,
          placedAt: true,
          // Drives the simulation boundary in every assignment path.
          isTest: true,
          addresses: true,
          payment: { select: { status: true, amountMinor: true, currency: true } },
        },
      },
      items: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  assignedDriver: {
    include: { user: { select: { firstName: true, lastName: true, ...AVATAR_SELECT } } },
  },
  assignedVehicle: true,
  timeline: { orderBy: { createdAt: 'asc' as const } },
  assignments: {
    orderBy: { assignedAt: 'asc' as const },
    include: { driverProfile: { select: { displayName: true } } },
  },
} satisfies Prisma.OrderDeliveryInclude;

export type DeliveryWithGraph = Prisma.OrderDeliveryGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

/**
 * Shared delivery-execution primitives used by the admin dispatch, driver-jobs,
 * and customer/vendor access services: the state-machine guard, append-only
 * timeline + audit + notification writers, PIN generation/verification, and
 * audience-scoped serialization. Keeping these here avoids duplicating delivery
 * logic across the role services.
 */
@Injectable()
export class DeliveryCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** Guard: throw unless `action` is legal from `current`. */
  assertAction(action: DeliveryAction, current: DeliveryStatus): void {
    if (!canPerform(action, current)) {
      const label = DELIVERY_STATUS_LABELS[current] ?? current;
      throw new BadRequestException(`Cannot ${action.toLowerCase().replace('_', ' ')} a delivery that is "${label}".`);
    }
  }

  /** A numeric verification PIN (leading zeros preserved). */
  genPin(): string {
    return String(randomInt(0, 10 ** DELIVERY_PIN_LENGTH)).padStart(DELIVERY_PIN_LENGTH, '0');
  }

  /** Append an immutable timeline event (within the caller's transaction). */
  async appendTimeline(
    tx: Prisma.TransactionClient,
    deliveryId: string,
    e: { fromStatus?: DeliveryStatus | null; toStatus?: DeliveryStatus | null; event: string; actorRole: string; actorUserId?: string | null; note?: string | null },
  ): Promise<void> {
    await tx.deliveryTimelineEvent.create({
      data: {
        orderDeliveryId: deliveryId,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        event: e.event,
        actorRole: e.actorRole,
        actorUserId: e.actorUserId ?? null,
        note: e.note ?? null,
      },
    });
  }

  /** One DELIVERY-category notification event fanned out to each distinct user
   *  (best-effort; within a tx if given). */
  async notify(
    userIds: Array<string | null | undefined>,
    msg: { title: string; body: string; data?: Record<string, unknown>; event?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.notifications.notifyUsers(
      userIds,
      { type: 'MARKETPLACE', category: 'DELIVERY', event: msg.event, title: msg.title, body: msg.body, data: msg.data },
      tx,
    );
  }

  /** Fan out an admin alert (e.g. a failed-delivery/verification lock). */
  async notifyAdmins(permission: string, msg: { title: string; body: string; data?: Record<string, unknown>; event?: string; category?: 'ADMIN_ALERT' | 'SECURITY' }, tx?: Prisma.TransactionClient): Promise<void> {
    await this.notifications.notifyAdmins(permission, { type: 'SECURITY', category: msg.category ?? 'ADMIN_ALERT', event: msg.event, title: msg.title, body: msg.body, data: msg.data }, tx);
  }

  async loadOrThrow(deliveryId: string): Promise<DeliveryWithGraph> {
    const d = await this.prisma.orderDelivery.findUnique({ where: { id: deliveryId }, include: DELIVERY_INCLUDE });
    if (!d) throw new NotFoundException('Delivery not found.');
    return d;
  }

  // ---- serialization ----

  private async podUrls(keys: string[]): Promise<string[]> {
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

  private vehicleSummary(v: DeliveryWithGraph['assignedVehicle']) {
    if (!v) return null;
    return { type: v.type, make: v.make, model: v.model, color: v.color, licencePlate: v.licencePlate };
  }

  private driverSummary(d: DeliveryWithGraph['assignedDriver']) {
    if (!d) return null;
    // Display name only — never legal name, phone, documents, or emergency contact.
    // The face is the point here: a customer opening the door should be able to
    // check that the person in front of them is the driver they were assigned.
    return {
      displayName: d.displayName,
      ratingAverage: d.ratingAverage,
      completedDeliveries: d.completedDeliveries,
      initials: userInitials(d.user.firstName, d.user.lastName),
      avatarUrl: publicAvatarUrl(d.user),
    };
  }

  timeline(d: DeliveryWithGraph) {
    return d.timeline.map((t) => ({ event: t.event, fromStatus: t.fromStatus, toStatus: t.toStatus, actorRole: t.actorRole, note: t.note, createdAt: t.createdAt }));
  }

  assignmentHistory(d: DeliveryWithGraph) {
    return d.assignments.map((a) => ({
      id: a.id,
      driver: a.driverProfile.displayName,
      status: a.status,
      assignedAt: a.assignedAt,
      respondedAt: a.respondedAt,
      endedAt: a.endedAt,
      declineReason: a.declineReason,
      endReason: a.endReason,
    }));
  }

  /**
   * Audience-scoped delivery view. PINs are never included here. The driver sees
   * only fulfilment-necessary customer info (address + name/phone from the order
   * address snapshot); the customer sees the driver display name + vehicle summary.
   */
  async serialize(d: DeliveryWithGraph, audience: DeliveryAudience) {
    const vo = d.vendorOrder;
    const order = vo.order;
    const address = order.addresses[0] ?? null;
    const pickupLocation = vo.vendorProfile.locations[0] ?? null;

    const base = {
      id: d.id,
      status: d.status,
      statusLabel: DELIVERY_STATUS_LABELS[d.status],
      vendorOrderId: vo.id,
      vendorOrderNumber: vo.orderNumber,
      orderNumber: order.orderNumber,
      feeMinor: money(d.feeMinor),
      freeApplied: d.freeApplied,
      estimate:
        d.estimateMinHours != null || d.estimateMaxHours != null || d.estimateLabel
          ? { minHours: d.estimateMinHours, maxHours: d.estimateMaxHours, label: d.estimateLabel }
          : null,
      instructions: d.instructions,
      vendor: { businessName: vo.vendorProfile.businessName, slug: vo.vendorProfile.slug },
      driver: this.driverSummary(d.assignedDriver),
      vehicle: this.vehicleSummary(d.assignedVehicle),
      recipientName: d.recipientName,
      timeline: this.timeline(d),
      timestamps: {
        assignedAt: d.assignedAt,
        acceptedAt: d.acceptedAt,
        pickupConfirmedAt: d.pickupConfirmedAt,
        inTransitAt: d.inTransitAt,
        arrivingAt: d.arrivingAt,
        deliveredAt: d.deliveredAt,
        cancelledAt: d.cancelledAt,
      },
      placedAt: order.placedAt,
      createdAt: d.createdAt,
    };

    const deliveryAddress = address
      ? { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, addressLine2: address.addressLine2, city: address.city, district: address.district, country: address.country }
      : null;

    const items = vo.items.map((i) => ({ productTitle: i.productTitle, variantTitle: i.variantTitle, quantity: i.quantity }));
    const podPhotoUrls = await this.podUrls(d.podPhotoKeys);

    if (audience === 'DRIVER') {
      /**
       * The customer's identity is earned by ACCEPTING, not by being offered.
       *
       * Automatic dispatch offers one delivery to up to five drivers in turn
       * (DISPATCH_MAX_OFFERS). Serializing the full address for anyone the job is
       * merely assigned to therefore handed a customer's name, phone number and
       * street to every driver who glanced at the offer and passed — people with
       * no relationship to them and no delivery to make.
       *
       * Before acceptance a driver gets what the decision actually needs: the
       * area, the fee, the vendor and the item count. `acceptedAt` is the gate
       * because it is the moment the driver commits, and it is cleared on every
       * re-offer, so a declined driver does not keep the details.
       */
      const committed = d.acceptedAt != null;
      const driverAddress = address
        ? committed
          ? deliveryAddress
          : { fullName: null, phone: null, addressLine1: null, addressLine2: null, city: address.city, district: address.district, country: address.country }
        : null;

      /**
       * The customer's map pin, and a link that opens it in the driver's own maps
       * app. Both are gated on acceptance for the same reason as the street
       * address — a pinned doorstep is MORE precise than the address, so if
       * anything it is the more sensitive of the two. Before acceptance the
       * driver has the area and the fee, which is what the decision needs.
       */
      const pin =
        committed && isWithinBelize(address?.latitude, address?.longitude)
          ? { latitude: address!.latitude as number, longitude: address!.longitude as number }
          : null;

      /**
       * WHERE TO COLLECT FROM.
       *
       * A business address, not a person's home, so it is not gated on
       * acceptance the way the customer's doorstep is — a driver deciding
       * whether to take the job needs to know how far the shop is. The pin and
       * the navigation link come from the vendor's configured location, which is
       * the authoritative collection point.
       */
      const pickupPin = isWithinBelize(pickupLocation?.latitude, pickupLocation?.longitude)
        ? { latitude: pickupLocation!.latitude as number, longitude: pickupLocation!.longitude as number }
        : null;

      return {
        ...base,
        // Area only until accepted; full fulfilment details afterwards.
        deliveryAddress: driverAddress,
        /** Whether `deliveryAddress` is the full address or the area-only view. */
        addressUnlocked: committed,
        /** The customer's exact pin, once this driver has taken the job. */
        pinnedLocation: pin,
        /** Opens the pin in the device's maps application. No mapping API involved. */
        navigationUrl: pin ? mapsNavigationUrl(pin, `Order ${order.orderNumber}`) : null,
        /** Free-text instructions the customer left ("blue gate"). Post-acceptance only. */
        deliveryInstructions: committed ? d.instructions : null,
        /** Flagged so a simulation is never mistaken for a real customer's order. */
        isTest: order.isTest,
        pickupLocation: pickupLocation
          ? {
              label: pickupLocation.label,
              addressLine1: pickupLocation.addressLine1,
              addressLine2: pickupLocation.addressLine2,
              city: pickupLocation.city,
              district: pickupLocation.district,
              // The vendor's own pin and note to the driver.
              pinnedLocation: pickupPin,
              navigationUrl: pickupPin ? mapsNavigationUrl(pickupPin, vo.vendorProfile.businessName) : null,
              pickupInstructions: committed ? pickupLocation.pickupInstructions : null,
            }
          : null,
        items,
        pickupVerified: d.pickupVerificationStatus !== 'PENDING',
        deliveryVerified: d.deliveryVerificationStatus !== 'PENDING',
        podPhotoUrls,
        // Whether the driver still needs a PIN (never the PIN itself).
        requiresPickupPin: !!d.pickupPin && d.pickupVerificationStatus === 'PENDING',
        requiresDeliveryPin: !!d.deliveryPin && d.deliveryVerificationStatus === 'PENDING',
      };
    }

    if (audience === 'CUSTOMER') {
      // `timeline` is the stored event log, which only begins at assignment. A
      // customer waiting for the shop to pack their order saw nothing in it, so
      // `progress` stitches the vendor-order stages onto the delivery ones and
      // always returns the full set of steps, reached or not.
      return {
        ...base,
        deliveryAddress,
        items,
        podPhotoUrls,
        progress: buildDeliveryProgress({
          placedAt: order.placedAt,
          preparingAt: vo.preparingAt,
          readyAt: vo.readyForPickupAt,
          assignedAt: d.assignedAt,
          acceptedAt: d.acceptedAt,
          pickupConfirmedAt: d.pickupConfirmedAt,
          inTransitAt: d.inTransitAt,
          arrivingAt: d.arrivingAt,
          deliveredAt: d.deliveredAt,
          cancelledAt: d.cancelledAt,
        }),
      };
    }

    if (audience === 'VENDOR') {
      return {
        ...base,
        deliveryAddress,
        items,
        pickupVerificationStatus: d.pickupVerificationStatus,
        deliveryVerificationStatus: d.deliveryVerificationStatus,
        podPhotoUrls,
      };
    }

    // ADMIN — full operational view (still no raw PINs; use the reveal endpoint).
    return {
      ...base,
      deliveryAddress,
      pickupLocation: pickupLocation
        ? { label: pickupLocation.label, addressLine1: pickupLocation.addressLine1, city: pickupLocation.city, district: pickupLocation.district }
        : null,
      items,
      customer: { userId: order.userId },
      pickupVerificationStatus: d.pickupVerificationStatus,
      deliveryVerificationStatus: d.deliveryVerificationStatus,
      pickupPinAttempts: d.pickupPinAttempts,
      deliveryPinAttempts: d.deliveryPinAttempts,
      assignedByUserId: d.assignedByUserId,
      podPhotoUrls,
      assignmentHistory: this.assignmentHistory(d),
      payment: order.payment ? { status: order.payment.status, amountMinor: money(order.payment.amountMinor), currency: order.payment.currency } : null,
      orderStatus: order.status,
    };
  }

  /** Record an audit row for a delivery transition (outside or inside a tx). */
  async auditTransition(
    action: DeliveryAction | 'POD',
    // Nullable: the dispatch engine assigns with no human actor, and the audit
    // row's null actorId is precisely what marks it as a system decision.
    actorId: string | null,
    deliveryId: string,
    extra?: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const auditAction: AuditAction = action === 'POD' ? 'DELIVERY_POD_UPLOADED' : AUDIT_FOR_ACTION[action];
    await this.audit.record({ action: auditAction, actorId, newValue: { deliveryId, ...(extra ?? {}) } }, tx);
  }
}
