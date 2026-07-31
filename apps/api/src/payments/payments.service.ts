import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionPayment, type PaymentStatus } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import type { Currency } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../products/inventory.service';
import { WalletService } from '../wallet/wallet.service';

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
    private readonly inventory: InventoryService,
    private readonly wallet: WalletService,
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
   * Release a payment's wallet holds and CANCEL the payment. A soft (HELD) hold
   * releases with NO money movement; an AUTHORIZED hold is reversed with a
   * balanced escrow→customer transaction (returns the escrowed funds). Called
   * from the order reservation-release path. Idempotent (holds are picked only
   * while HELD/AUTHORIZED; the release reference is unique).
   */
  async releaseForOrder(tx: Tx, orderId: string, actorId: string | null) {
    const payment = await tx.payment.findUnique({
      where: { orderId },
      include: { holds: { where: { status: { in: ['HELD', 'AUTHORIZED'] } } } },
    });
    if (!payment) return { released: false, holdsReleased: 0, escrowReturnedMinor: 0 };

    let escrowReturnedMinor = 0n;
    for (const hold of payment.holds) {
      if (hold.status === 'AUTHORIZED') {
        // Return escrowed funds: escrow → customer (balanced double-entry).
        const escrow = await this.wallet.ensureSystemAccount('SYSTEM_ESCROW', hold.currency, tx);
        const txn = await this.wallet.postTransaction(
          tx,
          {
            type: 'ESCROW_RELEASE',
            currency: hold.currency,
            reference: `payment:${payment.id}:release`,
            description: `Escrow release for payment ${payment.paymentNumber}`,
            lines: [
              { accountId: escrow.id, direction: 'DEBIT', amountMinor: hold.amountMinor },
              { accountId: hold.walletAccountId, direction: 'CREDIT', amountMinor: hold.amountMinor },
            ],
          },
          true,
        );
        escrowReturnedMinor += hold.amountMinor;
        await this.audit.record({ action: 'ESCROW_FUNDS_RELEASED', actorId, newValue: { paymentId: payment.id, amountMinor: money(hold.amountMinor), walletTransactionId: txn.id, from: 'escrow', to: 'customer' } }, tx);
        await this.audit.record({ action: 'WALLET_TRANSACTION_POSTED', actorId, newValue: { walletTransactionId: txn.id, type: 'ESCROW_RELEASE' } }, tx);
      }
      await tx.walletHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'order_reservation_released' } });
      await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'HOLD_RELEASED', data: { holdId: hold.id } } });
      await this.audit.record({ action: 'WALLET_HOLD_RELEASED', actorId, newValue: { holdId: hold.id, paymentId: payment.id } }, tx);
    }
    await tx.ledgerReference.updateMany({ where: { paymentId: payment.id, status: 'PENDING' }, data: { status: 'VOID' } });

    if (canTransitionPayment(payment.status, 'CANCELLED')) {
      await this.transition(tx, { id: payment.id, status: payment.status }, 'CANCELLED', actorId, { reason: 'order_reservation_released' });
    }
    return { released: true, holdsReleased: payment.holds.length, escrowReturnedMinor: money(escrowReturnedMinor) };
  }

  // ===========================================================================
  // Wallet authorization & escrow (M12) — the first real money movement
  // ===========================================================================

  /**
   * Authorize a PENDING payment from the customer's wallet: validate the wallet,
   * move funds customer → escrow (balanced ledger), post the LedgerReference, and
   * transition PENDING → AUTHORIZED. Idempotent (replays an AUTHORIZED payment;
   * the escrow transaction reference is unique). On validation failure, the whole
   * order is rolled back atomically (see failAuthorization). Money moves ONLY
   * between the customer wallet and escrow — vendor balances are untouched.
   */
  async authorize(actor: ActorContext, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== actor.userId) throw new NotFoundException('Payment not found.');
    if (payment.status === 'AUTHORIZED') return this.getOwn(actor.userId, paymentId); // idempotent replay
    if (payment.status !== 'CREATED' && payment.status !== 'PENDING') {
      throw new ConflictException(`Cannot authorize a ${payment.status} payment.`);
    }

    // ---- Wallet validation ----
    const wallets = await this.prisma.walletAccount.findMany({ where: { userId: actor.userId, type: 'USER' } });
    const wallet = wallets.find((w) => w.currency === payment.currency);
    const reason = await this.walletRejectReason(wallet, wallets.length, payment.amountMinor);
    if (reason || !wallet) {
      await this.failAuthorization(actor, payment.id, reason ?? 'No wallet account found.');
      throw new ConflictException(reason ?? 'No wallet account found.');
    }

    // ---- Success: escrow authorization (one transaction) ----
    try {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { holds: { where: { status: 'HELD' } } } });
        if (fresh.status === 'AUTHORIZED') return; // concurrent replay
        if (fresh.status !== 'CREATED' && fresh.status !== 'PENDING') throw new ConflictException(`Cannot authorize a ${fresh.status} payment.`);

        const escrow = await this.wallet.ensureSystemAccount('SYSTEM_ESCROW', payment.currency, tx);
        const balance = await this.wallet.balanceMinor(wallet.id, tx); // authoritative, in-tx
        if (balance < payment.amountMinor) throw new ConflictException('Insufficient wallet balance.');

        const txn = await this.wallet.postTransaction(
          tx,
          {
            type: 'ESCROW_HOLD',
            currency: payment.currency,
            reference: `payment:${payment.id}:auth`, // unique → ledger-level idempotency
            description: `Escrow authorization for payment ${payment.paymentNumber}`,
            lines: [
              { accountId: wallet.id, direction: 'DEBIT', amountMinor: payment.amountMinor },
              { accountId: escrow.id, direction: 'CREDIT', amountMinor: payment.amountMinor },
            ],
          },
          true,
        );
        const customerEntry = txn.entries.find((e) => e.accountId === wallet.id);
        for (const hold of fresh.holds) {
          await tx.walletHold.update({ where: { id: hold.id }, data: { status: 'AUTHORIZED', authorizedAt: new Date(), walletTransactionId: txn.id } });
        }
        await tx.ledgerReference.updateMany({ where: { paymentId: payment.id, status: 'PENDING' }, data: { status: 'POSTED', walletTransactionId: txn.id, walletLedgerEntryId: customerEntry?.id ?? null, postedAt: new Date() } });
        await this.transition(tx, { id: payment.id, status: fresh.status }, 'AUTHORIZED', actor.userId, { walletTransactionId: txn.id });
        await this.audit.record({ action: 'ESCROW_FUNDS_HELD', actorId: actor.userId, newValue: { paymentId: payment.id, amountMinor: money(payment.amountMinor), walletTransactionId: txn.id, from: 'customer', to: 'escrow' } }, tx);
        await this.audit.record({ action: 'WALLET_TRANSACTION_POSTED', actorId: actor.userId, newValue: { walletTransactionId: txn.id, type: 'ESCROW_HOLD' } }, tx);
        await this.audit.record({ action: 'PAYMENT_AUTHORIZED', actorId: actor.userId, newValue: { paymentId: payment.id, paymentNumber: payment.paymentNumber, amountMinor: money(payment.amountMinor) } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.getOwn(actor.userId, paymentId); // concurrent authorize (duplicate reference)
      }
      throw e;
    }
    return this.getOwn(actor.userId, paymentId);
  }

  /** Returns a rejection reason if the wallet fails validation, else null. */
  private async walletRejectReason(
    wallet: { id: string; status: string; currency: Currency } | undefined,
    walletCount: number,
    amountMinor: bigint,
  ): Promise<string | null> {
    if (!wallet) return walletCount > 0 ? 'Wallet currency mismatch.' : 'No wallet account found.';
    if (wallet.status === 'LOCKED') return 'Wallet is locked.';
    if (wallet.status === 'SUSPENDED') return 'Wallet is suspended.';
    if (wallet.status !== 'ACTIVE') return 'Wallet is not active.';
    const balance = await this.wallet.balanceMinor(wallet.id);
    if (balance < amountMinor) return 'Insufficient wallet balance.';
    return null;
  }

  /**
   * Authorization failed → roll the whole order back atomically: release the
   * (soft) holds, release the inventory reservation, cancel the order + vendor
   * orders, void the ledger references, and mark the payment FAILED. Idempotent
   * (a terminal payment is skipped). No money moved (holds were never authorized).
   */
  private async failAuthorization(actor: ActorContext, paymentId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { holds: { where: { status: 'HELD' } }, order: { include: { vendorOrders: { include: { items: true } } } } },
      });
      if (!payment) return;
      if (payment.status !== 'CREATED' && payment.status !== 'PENDING') return; // already terminal — idempotent

      await this.audit.record({ action: 'WALLET_VALIDATION_FAILED', actorId: actor.userId, newValue: { paymentId, reason } }, tx);

      for (const hold of payment.holds) {
        await tx.walletHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'authorization_failed' } });
        await tx.paymentEvent.create({ data: { paymentId, type: 'HOLD_RELEASED', data: { holdId: hold.id } } });
        await this.audit.record({ action: 'WALLET_HOLD_RELEASED', actorId: actor.userId, newValue: { holdId: hold.id, paymentId } }, tx);
      }

      if (payment.order && !payment.order.reservationsReleasedAt) {
        for (const vo of payment.order.vendorOrders) {
          for (const item of vo.items) {
            if (!item.productId) continue;
            const inv = await this.inventory.rowFor(item.productId, item.variantId, tx);
            if (inv) await this.inventory.release(inv.id, item.quantity, tx);
          }
        }
        await tx.order.update({ where: { id: payment.orderId }, data: { status: 'CANCELLED', reservationsReleasedAt: new Date() } });
        await tx.vendorOrder.updateMany({ where: { orderId: payment.orderId }, data: { status: 'CANCELLED' } });
        await this.audit.record({ action: 'ORDER_RESERVATION_RELEASED', actorId: actor.userId, newValue: { orderId: payment.orderId, reason: 'authorization_failed' } }, tx);
      }

      await tx.ledgerReference.updateMany({ where: { paymentId, status: 'PENDING' }, data: { status: 'VOID' } });
      await this.transition(tx, { id: paymentId, status: payment.status }, 'FAILED', actor.userId, { reason });
      await this.audit.record({ action: 'PAYMENT_AUTHORIZATION_FAILED', actorId: actor.userId, newValue: { paymentId, reason } }, tx);
    });
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
      holds: p.holds.map((h) => ({ id: h.id, status: h.status, amountMinor: money(h.amountMinor), currency: h.currency, heldAt: h.heldAt, authorizedAt: h.authorizedAt, releasedAt: h.releasedAt, releaseReason: h.releaseReason, walletTransactionId: h.walletTransactionId })),
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
