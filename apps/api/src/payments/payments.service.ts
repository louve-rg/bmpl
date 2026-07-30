import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionPayment, type PaymentStatus } from '@bmpl/shared';
import type { Currency, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

type Tx = Prisma.TransactionClient;
const money = (v: bigint) => Number(v);
const genPaymentNumber = () => `PAY-${randomBytes(5).toString('hex').toUpperCase()}`;

/**
 * Payment & wallet-hold FOUNDATION (M11). No money moves: no wallet ledger
 * entries are written, no balances change, no capture/settlement occurs. Reuses
 * the existing WalletAccount; holds and ledger references are metadata only.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Write paths (called INSIDE the checkout / release transactions)
  // ===========================================================================

  /**
   * Create the payment graph for a freshly-created order: Payment (CREATED→
   * PENDING), a WALLET PaymentMethod, a soft WalletHold (HELD — no money moved),
   * and a PENDING LedgerReference (a planned movement, unposted). Emits payment
   * events + audit rows. Returns the payment.
   */
  async createForOrder(
    tx: Tx,
    order: { id: string; userId: string; totalMinor: bigint; currency: Currency },
    actor: ActorContext,
  ) {
    const wallet = await this.ensureUserWallet(tx, order.userId, order.currency);
    const method = await tx.paymentMethod.upsert({
      where: { userId_type: { userId: order.userId, type: 'WALLET' } },
      update: {},
      create: { userId: order.userId, type: 'WALLET', label: 'Platform wallet', isDefault: true },
    });

    const payment = await tx.payment.create({
      data: {
        paymentNumber: genPaymentNumber(),
        orderId: order.id,
        userId: order.userId,
        amountMinor: order.totalMinor,
        currency: order.currency,
        status: 'CREATED',
        methodType: 'WALLET',
        paymentMethodId: method.id,
      },
    });
    await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'CREATED', toStatus: 'CREATED' } });
    await this.audit.record(
      {
        action: 'PAYMENT_CREATED',
        actorId: actor.userId,
        ipAddress: actor.ipAddress ?? null,
        sessionId: actor.sessionId ?? null,
        newValue: { paymentId: payment.id, paymentNumber: payment.paymentNumber, orderId: order.id, amountMinor: money(order.totalMinor) },
      },
      tx,
    );

    // Soft wallet hold (reservation of intent) — NOT an escrow ledger entry.
    const hold = await tx.walletHold.create({
      data: { paymentId: payment.id, walletAccountId: wallet.id, amountMinor: order.totalMinor, currency: order.currency, status: 'HELD' },
    });
    await tx.paymentEvent.create({
      data: { paymentId: payment.id, type: 'HOLD_CREATED', data: { holdId: hold.id, amountMinor: money(order.totalMinor) } },
    });
    await this.audit.record(
      { action: 'WALLET_HOLD_CREATED', actorId: actor.userId, ipAddress: actor.ipAddress ?? null, sessionId: actor.sessionId ?? null, newValue: { holdId: hold.id, paymentId: payment.id, amountMinor: money(order.totalMinor) } },
      tx,
    );

    // Planned (unposted) ledger movement — filled in when capture happens (later).
    await tx.ledgerReference.create({
      data: { paymentId: payment.id, walletAccountId: wallet.id, purpose: 'CUSTOMER_PAYMENT', direction: 'DEBIT', amountMinor: order.totalMinor, currency: order.currency, status: 'PENDING' },
    });

    // CREATED → PENDING (awaiting processing; capture is a later milestone).
    await this.transition(tx, { id: payment.id, status: 'CREATED' }, 'PENDING', actor.userId, { reason: 'awaiting_processing' });
    return payment;
  }

  /**
   * Release a payment's wallet holds and CANCEL the payment (no money moved).
   * Called from the order reservation-release path. Idempotent: a payment already
   * terminal has nothing to release.
   */
  async releaseForOrder(tx: Tx, orderId: string, actorId: string | null) {
    const payment = await tx.payment.findUnique({
      where: { orderId },
      include: { holds: { where: { status: 'HELD' } } },
    });
    if (!payment) return { released: false, holdsReleased: 0 };

    for (const hold of payment.holds) {
      await tx.walletHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'order_reservation_released' } });
      await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'HOLD_RELEASED', data: { holdId: hold.id } } });
      await this.audit.record({ action: 'WALLET_HOLD_RELEASED', actorId, newValue: { holdId: hold.id, paymentId: payment.id } }, tx);
    }
    await tx.ledgerReference.updateMany({ where: { paymentId: payment.id, status: 'PENDING' }, data: { status: 'VOID' } });

    if (canTransitionPayment(payment.status, 'CANCELLED')) {
      await this.transition(tx, { id: payment.id, status: payment.status }, 'CANCELLED', actorId, { reason: 'order_reservation_released' });
    }
    return { released: true, holdsReleased: payment.holds.length };
  }

  /** Guarded payment state transition + event + audit. */
  private async transition(
    tx: Tx,
    payment: { id: string; status: PaymentStatus },
    to: PaymentStatus,
    actorId: string | null,
    data?: Record<string, unknown>,
  ) {
    if (!canTransitionPayment(payment.status, to)) {
      throw new ConflictException(`Illegal payment transition ${payment.status} → ${to}.`);
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: to, authorizedAt: to === 'AUTHORIZED' ? new Date() : undefined },
    });
    await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'STATE_CHANGED', fromStatus: payment.status, toStatus: to, data: data as Prisma.InputJsonValue } });
    await this.audit.record(
      { action: 'PAYMENT_STATE_CHANGED', actorId, previousValue: { status: payment.status }, newValue: { status: to } },
      tx,
    );
  }

  /** The customer's USER/BZD wallet account (created at registration; find-or-create). */
  private async ensureUserWallet(tx: Tx, userId: string, currency: Currency) {
    const existing = await tx.walletAccount.findFirst({ where: { userId, type: 'USER', currency } });
    if (existing) return existing;
    return tx.walletAccount.create({ data: { userId, type: 'USER', currency } });
  }

  // ===========================================================================
  // Customer reads (self-scoped)
  // ===========================================================================

  async listOwn(userId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { orderNumber: true, itemCount: true } }, holds: true },
    });
    return rows.map((p) => this.cardShape(p));
  }

  async getOwn(userId: string, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, ...PAYMENT_DETAIL_INCLUDE });
    if (!p || p.userId !== userId) throw new NotFoundException('Payment not found.');
    return this.detailShape(p);
  }

  async statusOwn(userId: string, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, select: { id: true, userId: true, paymentNumber: true, status: true } });
    if (!p || p.userId !== userId) throw new NotFoundException('Payment not found.');
    return { id: p.id, paymentNumber: p.paymentNumber, status: p.status };
  }

  async forOrder(userId: string, orderId: string) {
    const p = await this.prisma.payment.findUnique({ where: { orderId }, ...PAYMENT_DETAIL_INCLUDE });
    if (!p || p.userId !== userId) throw new NotFoundException('Payment not found.');
    return this.detailShape(p);
  }

  // ===========================================================================
  // Admin reads (read-only; `payments.read`)
  // ===========================================================================

  async adminList() {
    const rows = await this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { order: { select: { orderNumber: true } }, user: { select: { firstName: true, lastName: true, email: true } }, holds: true },
    });
    return rows.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      orderNumber: p.order.orderNumber,
      status: p.status,
      methodType: p.methodType,
      amountMinor: money(p.amountMinor),
      currency: p.currency,
      customer: `${p.user.firstName} ${p.user.lastName}`,
      customerEmail: p.user.email,
      holds: p.holds.map((h) => ({ status: h.status, amountMinor: money(h.amountMinor) })),
      createdAt: p.createdAt,
    }));
  }

  async adminGet(id: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: { ...PAYMENT_DETAIL_INCLUDE.include, user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!p) throw new NotFoundException('Payment not found.');
    return { ...this.detailShape(p), customer: { name: `${p.user.firstName} ${p.user.lastName}`, email: p.user.email } };
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  private cardShape(p: { id: string; paymentNumber: string; status: string; methodType: string; amountMinor: bigint; currency: string; createdAt: Date; order: { orderNumber: string; itemCount: number }; holds: Array<{ status: string; amountMinor: bigint }> }) {
    return {
      id: p.id,
      paymentNumber: p.paymentNumber,
      orderNumber: p.order.orderNumber,
      itemCount: p.order.itemCount,
      status: p.status,
      methodType: p.methodType,
      amountMinor: money(p.amountMinor),
      currency: p.currency,
      holdStatus: p.holds[0]?.status ?? null,
      createdAt: p.createdAt,
    };
  }

  private detailShape(p: PaymentWithDetail) {
    return {
      id: p.id,
      paymentNumber: p.paymentNumber,
      status: p.status,
      methodType: p.methodType,
      amountMinor: money(p.amountMinor),
      currency: p.currency,
      authorizedAt: p.authorizedAt,
      createdAt: p.createdAt,
      order: { id: p.order.id, orderNumber: p.order.orderNumber, itemCount: p.order.itemCount, totalMinor: money(p.order.totalMinor), vendorOrders: p.order.vendorOrders.map((vo) => ({ id: vo.id, orderNumber: vo.orderNumber, businessName: vo.vendorProfile.businessName, subtotalMinor: money(vo.subtotalMinor) })) },
      holds: p.holds.map((h) => ({ id: h.id, status: h.status, amountMinor: money(h.amountMinor), currency: h.currency, heldAt: h.heldAt, releasedAt: h.releasedAt, releaseReason: h.releaseReason })),
      ledgerReferences: p.ledgerRefs.map((l) => ({ id: l.id, purpose: l.purpose, direction: l.direction, amountMinor: money(l.amountMinor), status: l.status, walletTransactionId: l.walletTransactionId })),
      events: p.events.map((e) => ({ type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, createdAt: e.createdAt })),
    };
  }
}

const PAYMENT_DETAIL_INCLUDE = {
  include: {
    order: { select: { id: true, orderNumber: true, itemCount: true, totalMinor: true, vendorOrders: { select: { id: true, orderNumber: true, subtotalMinor: true, vendorProfile: { select: { businessName: true } } } } } },
    holds: { orderBy: { createdAt: 'asc' as const } },
    ledgerRefs: true,
    events: { orderBy: { createdAt: 'asc' as const } },
  },
} satisfies { include: Prisma.PaymentInclude };

type PaymentWithDetail = Prisma.PaymentGetPayload<typeof PAYMENT_DETAIL_INCLUDE>;
