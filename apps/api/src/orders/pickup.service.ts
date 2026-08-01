import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfirmPickupInput, PickupOverrideInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from '../products/inventory.service';
import { OwnershipService } from '../products/ownership.service';

interface Actor {
  userId: string;
  permissions?: string[];
  ipAddress?: string | null;
  sessionId?: string | null;
}

const PICKUP_PIN_MAX_ATTEMPTS = 5;

/**
 * Pickup fulfilment (M18.1). Gives PICKUP vendor-orders a real completion signal —
 * the analogue of a delivery reaching DELIVERED — so downstream features (M19 review
 * eligibility) have an authoritative "collected" event. The vendor marks the order
 * READY_FOR_PICKUP (a PIN is issued to the customer), then confirms collection by
 * submitting that PIN. Inventory is finalized exactly once at collection. Payment and
 * settlement boundaries are unchanged.
 */
@Injectable()
export class PickupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly inventory: InventoryService,
    private readonly ownership: OwnershipService,
  ) {}

  private genPin(): string {
    return String(randomInt(0, 10000)).padStart(4, '0');
  }

  private async ownedByVendor(userId: string, vendorOrderId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const vo = await this.load(vendorOrderId);
    if (vo.vendorProfileId !== vp) throw new NotFoundException('Order not found.');
    return vo;
  }

  private async load(vendorOrderId: string) {
    const vo = await this.prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      include: { items: true, order: { select: { userId: true, orderNumber: true } }, vendorProfile: { select: { userId: true } } },
    });
    if (!vo) throw new NotFoundException('Order not found.');
    return vo;
  }

  private assertPickup(vo: { deliveryMethod: string }) {
    if (vo.deliveryMethod !== 'PICKUP') throw new BadRequestException('This is not a pickup order.');
  }

  /** Vendor: mark a pickup order ready and issue the customer a collection PIN. */
  async markReadyForPickup(userId: string, vendorOrderId: string) {
    const vo = await this.ownedByVendor(userId, vendorOrderId);
    this.assertPickup(vo);
    if (vo.status === 'READY_FOR_PICKUP') return this.serialize(vo, { forVendor: true }); // idempotent
    if (vo.status !== 'PENDING') throw new ConflictException(`Cannot ready a ${vo.status} order for pickup.`);
    const pin = this.genPin();
    const updated = await this.prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: 'READY_FOR_PICKUP', readyForPickupAt: new Date(), pickupPin: pin, pickupPinAttempts: 0 } });
    await this.audit.record({ action: 'VENDOR_ORDER_READY_FOR_PICKUP', actorId: userId, newValue: { vendorOrderId, orderNumber: vo.orderNumber } });
    await this.notifications.createInApp({ userId: vo.order.userId, type: 'MARKETPLACE', category: 'ORDER', event: 'ORDER_PLACED', title: 'Ready for pickup', body: `Order ${vo.orderNumber} is ready to collect. Show your pickup code to the store.`, data: { vendorOrderId } });
    return this.serialize({ ...vo, ...updated }, { forVendor: true });
  }

  /** Vendor: confirm collection by submitting the customer's pickup PIN. */
  async confirmPickup(actor: Actor, vendorOrderId: string, dto: ConfirmPickupInput) {
    const vo = await this.ownedByVendor(actor.userId, vendorOrderId);
    this.assertPickup(vo);
    if (vo.status === 'PICKED_UP') return this.serialize(vo, { forVendor: true }); // idempotent
    if (vo.status !== 'READY_FOR_PICKUP') throw new ConflictException('Mark the order ready for pickup first.');
    await this.verifyPin(actor.userId, vendorOrderId, dto.pin);
    return this.finalize(vendorOrderId, actor.userId, null);
  }

  /** Admin override (requires orders.manage + a reason) — confirm without the PIN. */
  async adminConfirmPickup(actor: Actor, vendorOrderId: string, dto: PickupOverrideInput) {
    if (!actor.permissions?.includes('orders.manage')) throw new ForbiddenException('orders.manage required.');
    const vo = await this.load(vendorOrderId);
    this.assertPickup(vo);
    if (vo.status === 'PICKED_UP') return this.serialize(vo, { forVendor: true });
    if (vo.status !== 'READY_FOR_PICKUP' && vo.status !== 'PENDING') throw new ConflictException(`Cannot confirm pickup for a ${vo.status} order.`);
    return this.finalize(vendorOrderId, actor.userId, dto.reason);
  }

  /** Customer: reveal their own pickup PIN to show the store. */
  async customerPickupPin(userId: string, vendorOrderId: string) {
    const vo = await this.load(vendorOrderId);
    if (vo.order.userId !== userId) throw new NotFoundException('Order not found.');
    return { vendorOrderId, status: vo.status, pickupPin: vo.status === 'READY_FOR_PICKUP' ? vo.pickupPin : null, pickedUpAt: vo.pickedUpAt };
  }

  // ---- internals ----

  private async verifyPin(actorId: string, vendorOrderId: string, submitted: string) {
    const vo = await this.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, select: { pickupPin: true, pickupPinAttempts: true } });
    if (!vo.pickupPin) throw new BadRequestException('No pickup code is set for this order.');
    if (vo.pickupPinAttempts >= PICKUP_PIN_MAX_ATTEMPTS) throw new BadRequestException('Too many incorrect attempts. Ask an admin to confirm this pickup.');
    if (!timingSafeEqualStr(submitted, vo.pickupPin)) {
      const next = vo.pickupPinAttempts + 1;
      await this.prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { pickupPinAttempts: next } });
      await this.audit.record({ action: 'VENDOR_ORDER_PICKUP_PIN_FAILED', actorId, newValue: { vendorOrderId, attempts: next } });
      throw new BadRequestException(next >= PICKUP_PIN_MAX_ATTEMPTS ? 'Incorrect code. This order is now locked; ask an admin to confirm.' : 'Incorrect pickup code. Please try again.');
    }
  }

  /** Transition to PICKED_UP + finalize inventory exactly once, atomically. */
  private async finalize(vendorOrderId: string, actorId: string, reason: string | null) {
    const vo = await this.load(vendorOrderId);
    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, select: { inventoryFinalizedAt: true } });
      if (!fresh.inventoryFinalizedAt) {
        for (const item of vo.items) {
          if (!item.productId) continue; // product deleted — nothing tracked
          const inv = await this.inventory.rowFor(item.productId, item.variantId, tx);
          if (!inv) continue; // untracked inventory
          await this.inventory.finalizeReservation(inv.id, item.quantity, actorId, tx);
        }
      }
      await tx.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: 'PICKED_UP', pickedUpAt: new Date(), inventoryFinalizedAt: fresh.inventoryFinalizedAt ?? new Date() } });
      await this.audit.record({ action: 'VENDOR_ORDER_PICKED_UP', actorId, reason: reason ?? undefined, newValue: { vendorOrderId, orderNumber: vo.orderNumber, override: reason != null } }, tx);
      if (!fresh.inventoryFinalizedAt) await this.audit.record({ action: 'INVENTORY_FULFILLED', actorId, newValue: { vendorOrderId } }, tx);
      await this.notifications.notifyUsers([vo.order.userId, vo.vendorProfile.userId], { type: 'MARKETPLACE', category: 'ORDER', event: 'ORDER_PLACED', title: 'Order collected', body: `Order ${vo.orderNumber} was collected.`, data: { vendorOrderId } }, tx);
    });
    return this.serialize(await this.load(vendorOrderId), { forVendor: true });
  }

  private serialize(vo: { id: string; orderNumber: string; status: string; deliveryMethod: string; readyForPickupAt: Date | null; pickedUpAt: Date | null }, _opts: { forVendor?: boolean } = {}) {
    return { id: vo.id, orderNumber: vo.orderNumber, status: vo.status, deliveryMethod: vo.deliveryMethod, readyForPickupAt: vo.readyForPickupAt, pickedUpAt: vo.pickedUpAt };
  }
}

/** Constant-time PIN comparison. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
