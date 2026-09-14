import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CheckoutInput } from '@bmpl/validation';
import { DELIVERY_STAGE_LABELS, deliveryStage, type DeliveryStatus } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from '../products/inventory.service';
import { ProductImagesService } from '../products/product-images.service';
import { OwnershipService } from '../products/ownership.service';
import { effectiveUnitPrice } from '../products/pricing.util';
import { PaymentsService } from '../payments/payments.service';
import { DeliveryPricingService } from '../delivery/delivery.pricing';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

const money = (v: bigint) => Number(v);
const CHECKOUT_SCOPE = 'checkout';

/** A validated, priced, reserved line grouped under its vendor during checkout. */
interface CheckoutLine {
  vendorProfileId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPriceMinor: bigint;
  quantity: number;
  subtotalMinor: bigint;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly inventory: InventoryService,
    private readonly images: ProductImagesService,
    private readonly ownership: OwnershipService,
    private readonly payments: PaymentsService,
    private readonly deliveryPricing: DeliveryPricingService,
  ) {}

  // ===========================================================================
  // Checkout — cart → order graph, atomically (one transaction)
  // ===========================================================================

  async checkout(actor: ActorContext, dto: CheckoutInput, idempotencyKey?: string) {
    // Idempotency fast path: a completed key replays the original order/payment
    // instead of creating duplicates (safe under distributed retries).
    if (idempotencyKey) {
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { userId_scope_key: { userId: actor.userId, scope: CHECKOUT_SCOPE, key: idempotencyKey } },
      });
      if (existing?.resultOrderId) {
        await this.audit.record({ action: 'IDEMPOTENCY_KEY_REPLAYED', actorId: actor.userId, newValue: { scope: CHECKOUT_SCOPE, orderId: existing.resultOrderId } });
        return this.getOwn(actor.userId, existing.resultOrderId);
      }
      if (existing) throw new ConflictException('A checkout with this idempotency key is already in progress.');
    }

    let orderId: string;
    try {
      orderId = await this.runCheckout(actor, dto, idempotencyKey);
    } catch (e) {
      // Concurrent duplicate: the unique (user, scope, key) lost the race.
      if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId: actor.userId, scope: CHECKOUT_SCOPE, key: idempotencyKey } },
        });
        if (existing?.resultOrderId) return this.getOwn(actor.userId, existing.resultOrderId);
        throw new ConflictException('A duplicate checkout is already in progress.');
      }
      throw e;
    }
    return this.getOwn(actor.userId, orderId);
  }

  private async runCheckout(actor: ActorContext, dto: CheckoutInput, idempotencyKey?: string): Promise<string> {
    const choiceByVendor = new Map(dto.vendors.map((v) => [v.vendorProfileId, v]));

    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({ where: { userId: actor.userId }, include: { items: { orderBy: { createdAt: 'asc' } } } });
      if (!cart || cart.items.length === 0) throw new BadRequestException('Your cart is empty.');

      // Reserve the idempotency key up front — a concurrent duplicate hits the
      // unique constraint here (→ P2002, handled by the caller).
      const idemRow = idempotencyKey
        ? await tx.idempotencyKey.create({ data: { userId: actor.userId, scope: CHECKOUT_SCOPE, key: idempotencyKey, status: 'IN_PROGRESS' } })
        : null;

      // ---- Validate every line, recompute price, reserve inventory ----
      const linesByVendor = new Map<string, CheckoutLine[]>();
      for (const item of cart.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          include: {
            vendorProfile: { select: { id: true, approvalStatus: true } },
            variants: { where: { isActive: true }, select: { id: true } },
          },
        });
        if (!product) throw new ConflictException('A product in your cart is no longer available.');
        if (product.status !== 'PUBLISHED') throw new ConflictException(`"${product.title}" is no longer available.`);
        if (product.vendorProfile.approvalStatus !== 'APPROVED') {
          throw new ConflictException(`The store for "${product.title}" is not currently active.`);
        }

        let variant: { id: string; sku: string | null; priceMinor: bigint | null; salePriceMinor: bigint | null } | null = null;
        let variantTitle: string | null = null;
        if (item.variantId) {
          const v = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            include: { inventory: true, optionValues: { select: { optionValue: { select: { value: true, option: { select: { position: true } } } } } } },
          });
          if (!v || v.productId !== item.productId || !v.isActive) {
            throw new ConflictException(`A selected option for "${product.title}" is unavailable.`);
          }
          variant = v;
          const optionLabel =
            v.optionValues
              .map((ov) => ov.optionValue)
              .sort((a, b) => a.option.position - b.option.position)
              .map((ov) => ov.value)
              .join(' / ') || null;
          // Snapshot the variant's marketplace title (displayName → option label),
          // so the order permanently shows the variant the customer purchased.
          variantTitle = v.displayName?.trim() || optionLabel;
        } else if (product.variants.length > 0) {
          throw new ConflictException(`"${product.title}" requires an option to be selected.`);
        }

        const unitPriceMinor = effectiveUnitPrice(product, variant);

        // Final inventory validation + reservation (skipped for untracked/unlimited).
        const inv = item.variantId
          ? await this.inventory.rowFor(item.productId, item.variantId, tx)
          : await this.inventory.rowFor(item.productId, null, tx);
        if (inv && !inv.unlimited) {
          const a = this.inventory.availability(inv);
          if (!a.allowBackorders && a.available !== null && a.available < item.quantity) {
            throw new ConflictException(`Not enough stock for "${product.title}".`);
          }
          await this.inventory.reserve(inv.id, item.quantity, tx); // rolls back with the tx on any later failure
        }

        const line: CheckoutLine = {
          vendorProfileId: product.vendorProfileId,
          productId: item.productId,
          variantId: item.variantId,
          productTitle: product.title,
          variantTitle,
          sku: variant?.sku ?? product.sku,
          unitPriceMinor,
          quantity: item.quantity,
          subtotalMinor: unitPriceMinor * BigInt(item.quantity),
        };
        const list = linesByVendor.get(product.vendorProfileId) ?? [];
        list.push(line);
        linesByVendor.set(product.vendorProfileId, list);
      }

      // ---- Delivery (M13): validate method offered + price per vendor ----
      const address = dto.deliveryAddress;
      const anyDelivery = [...linesByVendor.keys()].some(
        (vpId) => (choiceByVendor.get(vpId)?.deliveryMethod ?? 'PICKUP') === 'DELIVERY',
      );
      if (anyDelivery && !address) {
        throw new BadRequestException('A delivery address is required for delivery orders.');
      }

      interface VendorDelivery {
        feeMinor: bigint;
        freeApplied: boolean;
        estimate: { minHours: number; maxHours: number; label: string | null } | null;
        appliedZoneId: string | null;
        instructions: string | null;
      }
      const deliveryByVendor = new Map<string, VendorDelivery>();
      let deliveryFeeMinor = 0n;
      for (const [vpId, lines] of linesByVendor) {
        const choice = choiceByVendor.get(vpId);
        const method = choice?.deliveryMethod ?? 'PICKUP';
        const settings = await tx.vendorSettings.findUnique({ where: { vendorProfileId: vpId } });
        if (method === 'PICKUP') {
          if (settings && !settings.pickupEnabled) throw new BadRequestException('This store does not offer pickup.');
          continue;
        }
        const vSubtotal = lines.reduce((s, l) => s + l.subtotalMinor, 0n);
        const q = await this.deliveryPricing.quote(vpId, address!.district, vSubtotal);
        if (!q.deliverable) {
          const msg =
            q.reason === 'PICKUP_ONLY'
              ? 'This store does not offer delivery.'
              : q.reason === 'BELOW_MINIMUM'
                ? `Order is below this store's minimum for delivery ($${(Number(q.minimumOrderMinor ?? 0n) / 100).toFixed(2)}).`
                : `This store does not deliver to ${address!.district.replace('_', ' ')}.`;
          throw new BadRequestException(msg);
        }
        deliveryByVendor.set(vpId, {
          feeMinor: q.feeMinor,
          freeApplied: q.freeApplied,
          estimate: q.estimate,
          appliedZoneId: q.appliedZoneId,
          instructions: choice?.deliveryInstructions?.trim() || null,
        });
        deliveryFeeMinor += q.feeMinor;
      }

      // ---- Simulation flag: DERIVED from the storefront, never from the request ----
      //
      // An order is a simulation because of WHERE it was bought, not because the
      // client asked for it. `isTest` appears nowhere in CheckoutInput, so there
      // is no field to forge: buying from a real store can never produce a test
      // order however the request is crafted, and buying from a simulation store
      // yields nothing real — those storefronts stock nothing a customer wants,
      // and their deliveries can only ever reach a designated test driver.
      //
      // A cart mixing both is refused rather than silently resolved. Either
      // answer would be wrong: false would let a rehearsal delivery be offered to
      // a real driver, true would hide a genuine purchase from revenue.
      const vendorFlags = await tx.vendorProfile.findMany({
        where: { id: { in: [...linesByVendor.keys()] } },
        select: { id: true, isTest: true, businessName: true },
      });
      const testVendors = vendorFlags.filter((v) => v.isTest);
      if (testVendors.length > 0 && testVendors.length !== vendorFlags.length) {
        throw new BadRequestException(
          'A simulation store cannot be checked out together with a real store. Please order from them separately.',
        );
      }
      const isTest = vendorFlags.length > 0 && testVendors.length === vendorFlags.length;

      // ---- Create the order graph ----
      const orderNumber = genOrderNumber();
      const allLines = [...linesByVendor.values()].flat();
      const subtotalMinor = allLines.reduce((s, l) => s + l.subtotalMinor, 0n);
      const itemCount = allLines.reduce((s, l) => s + l.quantity, 0);

      const totalMinor = subtotalMinor + deliveryFeeMinor;
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: actor.userId,
          status: 'PENDING',
          currency: 'BZD',
          itemCount,
          subtotalMinor,
          deliveryFeeMinor,
          totalMinor, // subtotal + delivery (no tax/discounts yet)
          isTest,
        },
      });

      if (anyDelivery && dto.deliveryAddress) {
        await tx.orderAddress.create({
          data: {
            orderId: order.id,
            type: 'SHIPPING',
            fullName: dto.deliveryAddress.fullName,
            phone: dto.deliveryAddress.phone ?? null,
            addressLine1: dto.deliveryAddress.addressLine1 ?? null,
            addressLine2: dto.deliveryAddress.addressLine2 ?? null,
            city: dto.deliveryAddress.city,
            district: dto.deliveryAddress.district,
            latitude: dto.deliveryAddress.latitude ?? null,
            longitude: dto.deliveryAddress.longitude ?? null,
          },
        });
      }

      let idx = 0;
      for (const [vpId, lines] of linesByVendor) {
        idx += 1;
        const choice = choiceByVendor.get(vpId);
        const dv = deliveryByVendor.get(vpId);
        await tx.vendorOrder.create({
          data: {
            orderNumber: `${orderNumber}-${idx}`,
            orderId: order.id,
            vendorProfileId: vpId,
            status: 'PENDING',
            deliveryMethod: choice?.deliveryMethod ?? 'PICKUP',
            customerNotes: choice?.customerNotes ?? null,
            currency: 'BZD',
            itemCount: lines.reduce((s, l) => s + l.quantity, 0),
            subtotalMinor: lines.reduce((s, l) => s + l.subtotalMinor, 0n),
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                productTitle: l.productTitle,
                variantTitle: l.variantTitle,
                sku: l.sku,
                unitPriceMinor: l.unitPriceMinor,
                quantity: l.quantity,
                subtotalMinor: l.subtotalMinor,
                currency: 'BZD',
              })),
            },
            // Delivery snapshot (M13) — only for DELIVERY vendor-orders.
            ...(dv
              ? {
                  delivery: {
                    create: {
                      status: 'PENDING_ASSIGNMENT',
                      feeMinor: dv.feeMinor,
                      freeApplied: dv.freeApplied,
                      estimateMinHours: dv.estimate?.minHours ?? null,
                      estimateMaxHours: dv.estimate?.maxHours ?? null,
                      estimateLabel: dv.estimate?.label ?? null,
                      instructions: dv.instructions,
                      appliedZoneId: dv.appliedZoneId,
                    },
                  },
                }
              : {}),
          },
        });
      }

      // ---- Clear the cart (same transaction) ----
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      await this.audit.record(
        {
          action: 'ORDER_CREATED',
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { orderId: order.id, orderNumber, itemCount, subtotalMinor: money(subtotalMinor), vendorOrders: idx },
        },
        tx,
      );
      // Customer order-placed notification.
      await this.notifications.createInApp(
        {
          userId: actor.userId,
          type: 'MARKETPLACE',
          category: 'ORDER',
          event: 'ORDER_PLACED',
          title: 'Order placed',
          body: `Your order ${orderNumber} has been placed and is pending.`,
          data: { orderId: order.id, orderNumber },
        },
        tx,
      );
      // Vendor new-order notification, one per storefront in the order (M16).
      const vendorProfiles = await tx.vendorProfile.findMany({
        where: { id: { in: [...linesByVendor.keys()] } },
        select: { id: true, userId: true, businessName: true },
      });
      for (const vp of vendorProfiles) {
        await this.notifications.createInApp(
          {
            userId: vp.userId,
            type: 'MARKETPLACE',
            category: 'VENDOR',
            event: 'VENDOR_NEW_ORDER',
            title: 'New order',
            body: `You have a new order (${orderNumber}) to fulfil.`,
            data: { orderId: order.id, orderNumber, vendorProfileId: vp.id },
          },
          tx,
        );
      }

      // ---- Payment ----
      // Without `payWithWallet` this is the original behaviour: a PENDING
      // payment and a SOFT hold, no money moved, settled later.
      const payment = await this.payments.createForOrder(
        tx,
        { id: order.id, userId: actor.userId, totalMinor, currency: 'BZD' },
        actor,
      );

      // With it, the escrow debit happens HERE, inside the same transaction that
      // created the order. That is deliberate: if the customer cannot pay, this
      // throws, the whole transaction rolls back, and there is no order, no
      // reservation, no vendor notification and no cancelled row to explain. An
      // order that exists only to be cancelled a moment later is a worse
      // experience than never creating one.
      if (dto.payWithWallet) {
        await this.payments.escrowInTx(tx, payment.id, actor);
      }
      if (idemRow) {
        await tx.idempotencyKey.update({ where: { id: idemRow.id }, data: { status: 'COMPLETED', resultOrderId: order.id, resultPaymentId: payment.id } });
        await tx.payment.update({ where: { id: payment.id }, data: { idempotencyKeyId: idemRow.id } });
      }

      return order.id;
    });
  }

  // ===========================================================================
  // Operational: release an order's inventory reservations (M10.1)
  // ===========================================================================

  /**
   * Release the inventory reserved for an order (admin utility / maintenance).
   * Idempotent via `reservationsReleasedAt` — a second call is a no-op, so it can
   * never over-release another order's reservations. This is NOT customer
   * cancellation: the order row is left intact (status unchanged).
   */
  async releaseReservations(orderId: string, actorId?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { vendorOrders: { include: { items: true } } },
      });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.reservationsReleasedAt) {
        return { orderId, orderNumber: order.orderNumber, released: false, alreadyReleased: true, itemsReleased: 0 };
      }
      let itemsReleased = 0;
      for (const vo of order.vendorOrders) {
        for (const item of vo.items) {
          if (!item.productId) continue; // product deleted — nothing tracked to release
          const inv = await this.inventory.rowFor(item.productId, item.variantId, tx);
          if (!inv) continue; // untracked inventory — nothing reserved
          await this.inventory.release(inv.id, item.quantity, tx);
          itemsReleased += 1;
        }
      }
      await tx.order.update({ where: { id: orderId }, data: { reservationsReleasedAt: new Date() } });
      // Also release the payment's wallet hold + cancel the payment (M11) — no money moves.
      const payment = await this.payments.releaseForOrder(tx, orderId, actorId ?? null);
      await this.audit.record(
        {
          action: 'ORDER_RESERVATION_RELEASED',
          actorId: actorId ?? null,
          newValue: { orderId, orderNumber: order.orderNumber, itemsReleased, holdsReleased: payment.holdsReleased },
        },
        tx,
      );
      return { orderId, orderNumber: order.orderNumber, released: true, alreadyReleased: false, itemsReleased, holdsReleased: payment.holdsReleased };
    });
  }

  /**
   * Maintenance: release reservations for orders placed by the production
   * verification account (bounded + idempotent). Used by the startup task to
   * clean up reservations created solely for production verification.
   */
  async releaseVerificationReservations(email: string) {
    const orders = await this.prisma.order.findMany({
      where: { user: { email }, reservationsReleasedAt: null },
      select: { id: true },
      take: 50,
    });
    let itemsReleased = 0;
    for (const o of orders) {
      const r = await this.releaseReservations(o.id, null);
      itemsReleased += r.itemsReleased;
    }
    return { orders: orders.length, itemsReleased };
  }

  /**
   * Maintenance reconciliation: correct any STUCK `reserved` count for a (test)
   * account's already-terminal orders (reservationsReleasedAt set OR CANCELLED).
   * Clamped by `InventoryService.release` (never below 0) and skips rows already
   * at 0 — so it is safe and self-neutralizing (a no-op once counts are correct),
   * and it never touches an active PENDING reservation. Scoped to the given
   * account only.
   */
  async reconcileTerminalReservations(email: string) {
    const orders = await this.prisma.order.findMany({
      where: { user: { email }, OR: [{ reservationsReleasedAt: { not: null } }, { status: 'CANCELLED' }] },
      include: { vendorOrders: { include: { items: true } } },
      take: 100,
    });
    let corrected = 0;
    for (const o of orders) {
      for (const vo of o.vendorOrders) {
        for (const item of vo.items) {
          if (!item.productId) continue;
          const inv = await this.inventory.rowFor(item.productId, item.variantId);
          if (inv && inv.reserved > 0) {
            await this.inventory.release(inv.id, item.quantity);
            corrected += 1;
          }
        }
      }
    }
    return { corrected };
  }

  // ===========================================================================
  // Customer reads (self-scoped)
  // ===========================================================================

  async listOwn(userId: string) {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { vendorOrders: { select: { vendorProfile: { select: { businessName: true, slug: true } } } } },
    });
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      currency: o.currency,
      itemCount: o.itemCount,
      totalMinor: money(o.totalMinor),
      placedAt: o.placedAt,
      vendorCount: o.vendorOrders.length,
      vendors: o.vendorOrders.map((v) => v.vendorProfile.businessName),
    }));
  }

  async getOwn(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, ...ORDER_DETAIL_INCLUDE });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found.');
    return this.serializeOrder(order);
  }

  // ===========================================================================
  // Vendor reads (owner-scoped to the caller's storefront)
  // ===========================================================================

  async listForVendor(userId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const rows = await this.prisma.vendorOrder.findMany({
      where: { vendorProfileId: vp },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { user: { select: { firstName: true, lastName: true } } } },
        delivery: { select: { feeMinor: true, status: true } },
      },
    });
    return rows.map((vo) => ({
      id: vo.id,
      orderNumber: vo.orderNumber,
      status: vo.status,
      deliveryMethod: vo.deliveryMethod,
      deliveryFeeMinor: vo.delivery ? money(vo.delivery.feeMinor) : null,
      deliveryStatus: vo.delivery?.status ?? null,
      itemCount: vo.itemCount,
      subtotalMinor: money(vo.subtotalMinor),
      currency: vo.currency,
      createdAt: vo.createdAt,
      customerName: `${vo.order.user.firstName} ${vo.order.user.lastName}`,
    }));
  }

  async getForVendor(userId: string, vendorOrderId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const vo = await this.prisma.vendorOrder.findUnique({ where: { id: vendorOrderId }, ...VENDOR_ORDER_DETAIL_INCLUDE });
    if (!vo || vo.vendorProfileId !== vp) throw new NotFoundException('Order not found.');
    return this.serializeVendorOrder(vo, { includeCustomer: true });
  }

  // ===========================================================================
  // Admin reads (read-only; `orders.read`)
  // ===========================================================================

  async adminList() {
    const rows = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        vendorOrders: { select: { vendorProfile: { select: { businessName: true } } } },
      },
    });
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      itemCount: o.itemCount,
      totalMinor: money(o.totalMinor),
      currency: o.currency,
      placedAt: o.placedAt,
      customer: `${o.user.firstName} ${o.user.lastName}`,
      customerEmail: o.user.email,
      vendors: o.vendorOrders.map((v) => v.vendorProfile.businessName),
    }));
  }

  async adminGet(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        ...ORDER_DETAIL_INCLUDE.include,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    return {
      ...(await this.serializeOrder(order)),
      customer: { name: `${order.user.firstName} ${order.user.lastName}`, email: order.user.email },
    };
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  private async serializeOrder(order: OrderWithDetail) {
    const productIds = [...new Set(order.vendorOrders.flatMap((vo) => vo.items.map((i) => i.productId).filter((id): id is string => !!id)))];
    const primary = await this.images.primaryUrls(productIds);
    const address = order.addresses[0];
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      itemCount: order.itemCount,
      subtotalMinor: money(order.subtotalMinor),
      deliveryFeeMinor: money(order.deliveryFeeMinor),
      totalMinor: money(order.totalMinor),
      placedAt: order.placedAt,
      deliveryAddress: address
        ? {
            fullName: address.fullName,
            phone: address.phone,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2,
            city: address.city,
            district: address.district,
            country: address.country,
          }
        : null,
      vendorOrders: order.vendorOrders.map((vo) => this.shapeVendorOrder(vo, primary)),
    };
  }

  private serializeVendorOrder(vo: VendorOrderWithDetail, opts: { includeCustomer?: boolean } = {}) {
    return this.imagesFor(vo).then((primary) => {
      const base = this.shapeVendorOrder(vo, primary);
      const address = vo.order.addresses[0];
      return {
        ...base,
        parentOrderNumber: vo.order.orderNumber,
        placedAt: vo.order.placedAt,
        ...(opts.includeCustomer
          ? {
              customerName: `${vo.order.user.firstName} ${vo.order.user.lastName}`,
              deliveryAddress:
                vo.deliveryMethod === 'DELIVERY' && address
                  ? {
                      fullName: address.fullName,
                      phone: address.phone,
                      addressLine1: address.addressLine1,
                      addressLine2: address.addressLine2,
                      city: address.city,
                      district: address.district,
                      country: address.country,
                    }
                  : null,
            }
          : {}),
      };
    });
  }

  private async imagesFor(vo: VendorOrderWithDetail) {
    const productIds = [...new Set(vo.items.map((i) => i.productId).filter((id): id is string => !!id))];
    return this.images.primaryUrls(productIds);
  }

  private shapeVendorOrder(
    vo: { id: string; orderNumber: string; status: string; deliveryMethod: string; customerNotes: string | null; currency: string; itemCount: number; subtotalMinor: bigint; vendorProfile: { businessName: string; slug: string }; items: OrderItemRow[]; delivery?: DeliveryRow | null },
    primary: Map<string, string | null>,
  ) {
    const d = vo.delivery ?? null;
    const stage = d ? deliveryStage(d) : null;
    return {
      id: vo.id,
      orderNumber: vo.orderNumber,
      status: vo.status,
      deliveryMethod: vo.deliveryMethod,
      customerNotes: vo.customerNotes,
      // Delivery snapshot (M13): present only for DELIVERY vendor-orders.
      delivery: d
        ? {
            id: d.id,
            status: d.status,
            // The honest pre-collection stage (null once a driver accepted or
            // the delivery is finished) — status alone said "Awaiting driver"
            // while the store was still packing.
            stage,
            stageLabel: stage ? DELIVERY_STAGE_LABELS[stage] : null,
            feeMinor: money(d.feeMinor),
            freeApplied: d.freeApplied,
            estimate:
              d.estimateMinHours != null || d.estimateMaxHours != null || d.estimateLabel
                ? { minHours: d.estimateMinHours, maxHours: d.estimateMaxHours, label: d.estimateLabel }
                : null,
            instructions: d.instructions,
          }
        : null,
      currency: vo.currency,
      itemCount: vo.itemCount,
      subtotalMinor: money(vo.subtotalMinor),
      vendor: { businessName: vo.vendorProfile.businessName, slug: vo.vendorProfile.slug },
      items: vo.items.map((i) => ({
        productTitle: i.productTitle,
        variantTitle: i.variantTitle,
        sku: i.sku,
        unitPriceMinor: money(i.unitPriceMinor),
        quantity: i.quantity,
        subtotalMinor: money(i.subtotalMinor),
        currency: i.currency,
        productId: i.productId,
        imageUrl: i.productId ? primary.get(i.productId) ?? null : null,
      })),
    };
  }
}

interface OrderItemRow {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPriceMinor: bigint;
  quantity: number;
  subtotalMinor: bigint;
  currency: string;
  productId: string | null;
}

interface DeliveryRow {
  id: string;
  status: DeliveryStatus;
  readyForDispatchAt: Date | null;
  feeMinor: bigint;
  freeApplied: boolean;
  estimateMinHours: number | null;
  estimateMaxHours: number | null;
  estimateLabel: string | null;
  instructions: string | null;
}

const ORDER_DETAIL_INCLUDE = {
  include: {
    addresses: true,
    vendorOrders: {
      orderBy: { createdAt: 'asc' as const },
      include: { vendorProfile: { select: { businessName: true, slug: true } }, items: { orderBy: { createdAt: 'asc' as const } }, delivery: true },
    },
  },
} satisfies { include: Prisma.OrderInclude };

const VENDOR_ORDER_DETAIL_INCLUDE = {
  include: {
    vendorProfile: { select: { businessName: true, slug: true } },
    items: { orderBy: { createdAt: 'asc' as const } },
    delivery: true,
    order: { select: { orderNumber: true, placedAt: true, addresses: true, user: { select: { firstName: true, lastName: true } } } },
  },
} satisfies { include: Prisma.VendorOrderInclude };

type OrderWithDetail = Prisma.OrderGetPayload<typeof ORDER_DETAIL_INCLUDE>;
type VendorOrderWithDetail = Prisma.VendorOrderGetPayload<typeof VENDOR_ORDER_DETAIL_INCLUDE>;

/** Human-friendly, collision-resistant order number (BigInt-free, unique-indexed). */
function genOrderNumber(): string {
  return `ORD-${randomBytes(5).toString('hex').toUpperCase()}`;
}
