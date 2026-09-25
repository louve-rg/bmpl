import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OwnershipService } from '../products/ownership.service';
import { PickupService } from './pickup.service';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';

/**
 * Vendor fulfilment (M26.3 · Part 6).
 *
 * Closes the dead end that made delivery orders unworkable: a vendor received a
 * DELIVERY order and had no action available on it at all. VendorOrderStatus had
 * no state between PENDING and the pickup-only READY_FOR_PICKUP, and
 * vendor-orders.controller exposed two routes, both pickup-only. The order sat
 * there, the delivery sat in PENDING_ASSIGNMENT, and only an administrator could
 * move either — which is exactly the manual involvement this milestone removes.
 *
 * The flow is now: PENDING → PREPARING → READY_FOR_PICKUP, where "ready" hands
 * off to automatic dispatch for DELIVERY orders and issues a collection PIN for
 * PICKUP orders.
 *
 * PICKUP behaviour is deliberately UNCHANGED and still lives in PickupService —
 * this delegates to it rather than reimplementing PIN issuing, inventory
 * finalisation, or its notifications. Pickup already worked; the rule is to
 * protect what works.
 */
@Injectable()
export class VendorFulfilmentService {
  private readonly logger = new Logger(VendorFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ownership: OwnershipService,
    private readonly pickup: PickupService,
    private readonly engine: DispatchEngineService,
  ) {}

  /** Vendor: acknowledge the order and start assembling it. */
  async startPreparing(userId: string, vendorOrderId: string) {
    const vo = await this.ownedByVendor(userId, vendorOrderId);
    // Idempotent: a double-tap on a slow connection must not 409.
    if (vo.status === 'PREPARING') return this.view(vendorOrderId);
    if (vo.status !== 'PENDING') {
      throw new ConflictException(`This order is already ${label(vo.status)}.`);
    }
    // Conditional write, guarded in the WHERE: a customer's cancellation can
    // commit between the read above and this write. An unconditional
    // `where: { id }` would silently resurrect a just-CANCELLED vendor-order
    // back to PREPARING — the same race pattern `cancelOwn` itself guards
    // against, applied here in the other direction.
    const updated = await this.prisma.vendorOrder.updateMany({
      where: { id: vendorOrderId, status: 'PENDING' },
      data: { status: 'PREPARING', preparingAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await this.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, select: { status: true } });
      throw new ConflictException(`This order is already ${label(current.status)}.`);
    }
    await this.audit.record({
      action: 'VENDOR_ORDER_PREPARING',
      actorId: userId,
      newValue: { vendorOrderId, orderNumber: vo.order.orderNumber },
    });
    // The customer's timeline would otherwise show nothing between paying and a
    // driver appearing, which reads as a stalled order.
    await this.notifications.createInApp({
      userId: vo.order.userId,
      type: 'MARKETPLACE',
      category: 'ORDER',
      event: 'ORDER_PLACED',
      title: 'Your order is being prepared',
      body: `${vo.vendorProfile.businessName} has started preparing order ${vo.order.orderNumber}.`,
      data: { vendorOrderId },
    });
    return this.view(vendorOrderId);
  }

  /**
   * Vendor: the goods are packed and ready to hand over.
   *
   * For PICKUP this is the existing collection flow, untouched. For DELIVERY this
   * is the trigger that starts automatic dispatch — the vendor's action, not an
   * administrator's, is what puts the job in front of a driver.
   */
  async markReady(userId: string, vendorOrderId: string) {
    const vo = await this.ownedByVendor(userId, vendorOrderId);

    if (vo.deliveryMethod === 'PICKUP') {
      return this.pickup.markReadyForPickup(userId, vendorOrderId);
    }

    if (vo.status === 'READY_FOR_PICKUP') return this.view(vendorOrderId); // idempotent
    if (vo.status !== 'PENDING' && vo.status !== 'PREPARING') {
      throw new ConflictException(`Cannot ready a ${label(vo.status)} order.`);
    }

    const delivery = await this.prisma.orderDelivery.findUnique({
      where: { vendorOrderId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      throw new ConflictException('This order has no delivery attached. Contact support.');
    }

    const ready = await this.prisma.$transaction(async (tx) => {
      // Conditional write, guarded in the WHERE against the exact statuses this
      // method may leave: a customer's cancellation can commit between the read
      // above and this write. An unconditional `where: { id }` would silently
      // resurrect a just-CANCELLED vendor-order back to READY_FOR_PICKUP AND
      // re-arm dispatch (below) for an order the customer has already been
      // refunded for.
      const updated = await tx.vendorOrder.updateMany({
        where: { id: vendorOrderId, status: { in: ['PENDING', 'PREPARING'] } },
        data: { status: 'READY_FOR_PICKUP', readyForPickupAt: new Date() },
      });
      if (updated.count === 0) return false;
      // Marks the delivery dispatchable. Until this is set the engine ignores it,
      // so a driver is never sent to wait at a counter for goods still being packed.
      await tx.orderDelivery.update({
        where: { id: delivery.id },
        data: { readyForDispatchAt: new Date() },
      });
      return true;
    });
    if (!ready) {
      const current = await this.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId }, select: { status: true } });
      throw new ConflictException(`Cannot ready a ${label(current.status)} order.`);
    }

    await this.audit.record({
      action: 'VENDOR_ORDER_READY_FOR_DISPATCH',
      actorId: userId,
      newValue: { vendorOrderId, deliveryId: delivery.id, orderNumber: vo.order.orderNumber },
    });
    await this.notifications.createInApp({
      userId: vo.order.userId,
      type: 'MARKETPLACE',
      category: 'ORDER',
      event: 'ORDER_PLACED',
      title: 'Your order is ready',
      body: `Order ${vo.order.orderNumber} is packed and waiting for a driver.`,
      data: { vendorOrderId },
    });

    // Dispatch is best-effort and deliberately OUTSIDE the transaction: the
    // vendor's order is ready whether or not a driver is available this second.
    // A failure here leaves the delivery dispatchable for the sweeper to retry,
    // rather than rolling back a fulfilment step the vendor has physically done.
    try {
      await this.engine.dispatch(delivery.id);
    } catch (err) {
      this.logger.error(`auto-dispatch after ready failed for ${delivery.id}: ${String(err)}`);
    }

    return this.view(vendorOrderId);
  }

  // ---- internals ----

  private async ownedByVendor(userId: string, vendorOrderId: string) {
    // eslint-disable-next-line no-console
    console.log('[SVC DEBUG] this.prisma tag =', (this.prisma as unknown as { __testTag?: string }).__testTag, 'has $use?', typeof (this.prisma as unknown as { $use?: unknown }).$use);
    const vendorProfileId = await this.ownership.vendorProfileId(userId);
    const vo = await this.prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      include: {
        order: { select: { userId: true, orderNumber: true } },
        vendorProfile: { select: { userId: true, businessName: true } },
      },
    });
    // 404 rather than 403 on a cross-vendor id: a vendor should not be able to
    // probe whether another vendor's order exists.
    if (!vo || vo.vendorProfileId !== vendorProfileId) throw new NotFoundException('Order not found.');
    return vo;
  }

  private async view(vendorOrderId: string) {
    const vo = await this.prisma.vendorOrder.findUniqueOrThrow({
      where: { id: vendorOrderId },
      include: { delivery: { select: { id: true, status: true, offerCount: true } } },
    });
    return {
      id: vo.id,
      status: vo.status,
      deliveryMethod: vo.deliveryMethod,
      readyForPickupAt: vo.readyForPickupAt,
      delivery: vo.delivery,
    };
  }
}

const label = (status: string): string => status.toLowerCase().replace(/_/g, ' ');
