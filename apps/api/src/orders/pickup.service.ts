import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfirmPickupInput, PickupOverrideInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from '../products/inventory.service';
import { OwnershipService } from '../products/ownership.service';
import { SettlementService } from '../settlement/settlement.service';
import { assertReservationsNotReleased } from './order-release-guard';

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
    private readonly settlement: SettlementService,
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
      include: { items: true, order: { select: { userId: true, orderNumber: true, reservationsReleasedAt: true } }, vendorProfile: { select: { userId: true } } },
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
    if (vo.status === 'READY_FOR_PICKUP') return this.serialize(vo, { forVendor: true }); // idempotent, checked before the allow-list below
    // ORD-RELEASED-GUARD: this is the step that starts the collection flow —
    // stop it here and no PIN is ever issued for a released order.
    assertReservationsNotReleased(vo.order.reservationsReleasedAt);
    // Same positive allow-list as VendorFulfilmentService.markReady()'s DELIVERY
    // path: a pickup order that went through startPreparing() is still readyable.
    if (vo.status !== 'PENDING' && vo.status !== 'PREPARING') throw new ConflictException(`Cannot ready a ${vo.status} order for pickup.`);
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
    // ORD-RELEASED-GUARD: finalizes real inventory below — must not run for a
    // released order (see finalize()'s own comment on the over-decrement risk).
    assertReservationsNotReleased(vo.order.reservationsReleasedAt);
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
    // ORD-RELEASED-GUARD: the override still finalizes real inventory — it may
    // skip the PIN, never the money state.
    assertReservationsNotReleased(vo.order.reservationsReleasedAt);
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

  /**
   * Transition to PICKED_UP + finalize inventory exactly once, atomically.
   *
   * ORDER-PICKUP-DOUBLE-FINALIZE: the ONLY exactly-once guard used to be an
   * unlocked read of `inventoryFinalizedAt`, checked BEFORE
   * `finalizeReservation`/`finalizeLocationReservation` ever take their own
   * `FOR UPDATE` lock — and that lock is on the INVENTORY row, never on this
   * vendor-order. Two concurrent `confirmPickup` calls with the same valid
   * PIN (the PIN is never consumed/invalidated by verifyPin) both read
   * `inventoryFinalizedAt: null` before either committed, so both ran the
   * finalization loop: measured on a qty=2 order, {quantity:10,reserved:2}
   * went to {quantity:6,reserved:0} — four units gone, two FULFILLED
   * `InventoryChange` rows, both calls returning 201.
   *
   * Fixed by claiming the STATUS transition FIRST, via the same
   * conditional-claim pattern `DriverJobService.confirmPickup` already uses
   * for the identical class of race on the DELIVERY path (and every
   * SHIP-LEG-CONCURRENT-WRITES fix tonight): `updateMany` re-asserts the
   * exact status this call's own callers (`confirmPickup`,
   * `adminConfirmPickup`) already checked, non-atomically, before calling
   * here. Only one concurrent caller's `updateMany` can ever match — the
   * loser's `claimed.count` is 0 and it never reaches the inventory
   * finalization code at all, so `inventoryFinalizedAt`'s own unlocked read
   * is no longer load-bearing for concurrency; it stays as the exactly-once
   * guard for a (not currently reachable) future caller of this same
   * method, same role `OrderDelivery.inventoryFinalizedAt` plays after
   * `DriverJobService.confirmPickup`'s own claim.
   *
   * ORD-RELEASED-GUARD: `InventoryService.finalizeReservation`/
   * `finalizeLocationReservation` decrement real on-hand `quantity`
   * unconditionally — they do not throw or check `reserved` first, so
   * calling this for an order whose reservations were already released
   * (stock already given back, `reserved` already floored at 0, `quantity`
   * never touched by release) would silently take a SECOND real unit out of
   * stock for goods never actually finalized before. Both callers
   * (`confirmPickup`, `adminConfirmPickup`) now refuse before reaching here
   * once `order.reservationsReleasedAt` is set, so this is unreachable for a
   * released order — not re-guarded here too, to keep exactly one place
   * deciding "is this order still fulfillable".
   */
  private async finalize(vendorOrderId: string, actorId: string, reason: string | null) {
    const vo = await this.load(vendorOrderId);
    const won = await this.prisma.$transaction(async (tx) => {
      // ORDER-PICKUP-DOUBLE-FINALIZE: the claim gates everything below it —
      // a loser never reaches the inventory finalization loop.
      const claimed = await tx.vendorOrder.updateMany({
        where: { id: vendorOrderId, status: { in: ['READY_FOR_PICKUP', 'PENDING'] } },
        data: { status: 'PICKED_UP', pickedUpAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const fresh = await tx.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, select: { inventoryFinalizedAt: true } });
      if (!fresh.inventoryFinalizedAt) {
        for (const item of vo.items) {
          if (!item.productId) continue; // product deleted — nothing tracked
          const inv = await this.inventory.rowFor(item.productId, item.variantId, tx);
          if (!inv) continue; // untracked inventory
          // BMPL-175: finalize against the SAME row reserve() used — see
          // OrdersService.releaseReservationsInTx's identical comment.
          const locRow = vo.originLocationId ? await this.inventory.rowForLocation(inv.id, vo.originLocationId, tx) : null;
          if (locRow) {
            await this.inventory.finalizeLocationReservation(inv, locRow.id, item.quantity, actorId, tx);
          } else {
            await this.inventory.finalizeReservation(inv.id, item.quantity, actorId, tx);
          }
        }
        await tx.vendorOrder.update({ where: { id: vendorOrderId }, data: { inventoryFinalizedAt: new Date() } });
        await this.audit.record({ action: 'INVENTORY_FULFILLED', actorId, newValue: { vendorOrderId } }, tx);
      }
      await this.audit.record({ action: 'VENDOR_ORDER_PICKED_UP', actorId, reason: reason ?? undefined, newValue: { vendorOrderId, orderNumber: vo.orderNumber, override: reason != null } }, tx);
      await this.notifications.notifyUsers([vo.order.userId, vo.vendorProfile.userId], { type: 'MARKETPLACE', category: 'ORDER', event: 'ORDER_PLACED', title: 'Order collected', body: `Order ${vo.orderNumber} was collected.`, data: { vendorOrderId } }, tx);
      return true;
    });
    if (!won) {
      throw new ConflictException('This order changed state before pickup could be confirmed — reload and try again.');
    }
    // SHIP-PICKUP-NO-SETTLE: collection triggers internal settlement (M18),
    // mirroring DriverJobService.confirmDelivery's own trigger immediately
    // after its delivery transition commits — its own atomic, idempotent
    // transaction, outside this one. Never blocks/reverts the pickup; a
    // failure records a settlement exception + alerts admins and preserves
    // escrow. Shared by both callers of finalize() (the customer's own PIN
    // via confirmPickup, and the admin override) so neither leaves this
    // vendor-order's escrow stuck the way both did before this fix.
    await this.settlement.settleVendorOrder(vendorOrderId, actorId);
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
