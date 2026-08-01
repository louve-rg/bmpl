import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DELIVERY_PIN_MAX_ATTEMPTS,
  DELIVERY_STATUS_LABELS,
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  STORAGE_PREFIX,
  type DeliveryStatus,
} from '@bmpl/shared';
import type { ConfirmDeliveryInput, ConfirmPickupInput, DeclineJobInput, PodConfirmInput } from '@bmpl/validation';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../products/inventory.service';
import { MessagingService } from '../messaging/messaging.service';
import { DeliveryCoreService } from './delivery-core.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Driver job feed + operational transitions. A driver only ever sees/acts on
 * deliveries assigned to THEIR driver profile. Pickup/delivery are gated by a PIN
 * the driver submits (held by the vendor / recipient); attempts are rate-limited
 * and capped. Inventory is finalized exactly once at pickup confirmation.
 */
@Injectable()
export class DriverJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly core: DeliveryCoreService,
    private readonly messaging: MessagingService,
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

  async listJobs(userId: string, scope: 'active' | 'completed' | 'all' = 'active') {
    const profileId = await this.myProfileId(userId);
    const active: DeliveryStatus[] = ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'];
    const done: DeliveryStatus[] = ['DELIVERED'];
    const where: Prisma.OrderDeliveryWhereInput = {
      assignedDriverProfileId: profileId,
      ...(scope === 'active' ? { status: { in: active } } : scope === 'completed' ? { status: { in: done } } : {}),
    };
    const rows = await this.prisma.orderDelivery.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      take: 200,
      include: {
        vendorOrder: {
          select: {
            orderNumber: true,
            itemCount: true,
            vendorProfile: { select: { businessName: true } },
            order: { select: { orderNumber: true, addresses: { select: { city: true, district: true } } } },
          },
        },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      statusLabel: DELIVERY_STATUS_LABELS[d.status],
      orderNumber: d.vendorOrder.order.orderNumber,
      vendor: d.vendorOrder.vendorProfile.businessName,
      itemCount: d.vendorOrder.itemCount,
      city: d.vendorOrder.order.addresses[0]?.city ?? null,
      district: d.vendorOrder.order.addresses[0]?.district ?? null,
      feeMinor: Number(d.feeMinor),
      assignedAt: d.assignedAt,
      deliveredAt: d.deliveredAt,
    }));
  }

  async getJob(userId: string, deliveryId: string) {
    const { d } = await this.ownedDelivery(userId, deliveryId);
    return this.core.serialize(d, 'DRIVER');
  }

  // ---- transitions -------------------------------------------------------

  async accept(actor: Actor, deliveryId: string) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    if (d.status === 'DRIVER_ACCEPTED') return this.core.serialize(d, 'DRIVER'); // idempotent
    this.core.assertAction('ACCEPT', d.status);
    await this.prisma.$transaction(async (tx) => {
      await tx.orderDelivery.update({ where: { id: deliveryId }, data: { status: 'DRIVER_ACCEPTED', acceptedAt: new Date() } });
      await tx.deliveryAssignment.updateMany({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'ASSIGNED', toStatus: 'DRIVER_ACCEPTED', event: 'ACCEPT', actorRole: 'DRIVER', actorUserId: actor.userId });
      await this.core.auditTransition('ACCEPT', actor.userId, deliveryId, undefined, tx);
      await this.core.notify([d.vendorOrder.order.userId, d.vendorOrder.vendorProfile.userId], { title: 'Driver accepted', body: `Your driver accepted the delivery for order ${d.vendorOrder.order.orderNumber}.`, data: { deliveryId } }, tx);
    });
    return this.getJob(actor.userId, deliveryId);
  }

  async decline(actor: Actor, deliveryId: string, dto: DeclineJobInput) {
    const { d } = await this.ownedDelivery(actor.userId, deliveryId);
    this.core.assertAction('DECLINE', d.status);
    await this.prisma.$transaction(async (tx) => {
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        // Clear the current-driver denormalization so the delivery returns to the
        // dispatch pool; assignment history is preserved on the DeliveryAssignment row.
        data: { status: 'DRIVER_DECLINED', declinedAt: new Date(), declineReason: dto.reason, assignedDriverProfileId: null, assignedVehicleId: null },
      });
      await tx.deliveryAssignment.updateMany({ where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } }, data: { status: 'DECLINED', respondedAt: new Date(), endedAt: new Date(), declineReason: dto.reason } });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus: 'ASSIGNED', toStatus: 'DRIVER_DECLINED', event: 'DECLINE', actorRole: 'DRIVER', actorUserId: actor.userId, note: dto.reason });
      await this.core.auditTransition('DECLINE', actor.userId, deliveryId, { reason: dto.reason }, tx);
      // Notify the admin who assigned so they can reassign.
      await this.core.notify([d.assignedByUserId, d.vendorOrder.vendorProfile.userId], { title: 'Driver declined', body: `A driver declined the delivery for order ${d.vendorOrder.order.orderNumber}. Reassignment needed.`, data: { deliveryId } }, tx);
    });
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
    return this.getJob(actor.userId, deliveryId);
  }

  // ---- proof of delivery -------------------------------------------------

  async presignPod(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.deliveryProof(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  /** Attach POD photos (uploaded via presign) to an owned, not-yet-delivered job. */
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

/** Constant-time string comparison to avoid PIN timing leaks. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
