import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertBalanced, assertMoneyMovementEnabled, signedAmount, type DraftTransaction } from '@bmpl/wallet';
import type { Currency, Prisma, WalletAccount, WalletAccountType } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
const money = (v: bigint) => Number(v);

/**
 * Persistence layer for the double-entry ledger — the FIRST real money movement
 * (M12). Reuses the `@bmpl/wallet` primitives (`assertBalanced`,
 * `assertMoneyMovementEnabled`) so the balancing rules live in one place. Every
 * posted transaction MUST net to zero, and money movement is gated per-call.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Derived balance (minor units) = Σ signed ledger entries. The source of truth. */
  async balanceMinor(accountId: string, db: Db = this.prisma): Promise<bigint> {
    const entries = await db.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
    return entries.reduce((sum, e) => sum + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
  }

  /** Get-or-create a SYSTEM account (e.g. escrow) for a currency (userId = null). */
  async ensureSystemAccount(type: WalletAccountType, currency: Currency, tx: Tx): Promise<WalletAccount> {
    const existing = await tx.walletAccount.findFirst({ where: { type, userId: null, currency } });
    return existing ?? tx.walletAccount.create({ data: { type, currency } });
  }

  /** Get-or-create a user's USER wallet account for a currency (settlement payee). */
  async ensureUserAccount(userId: string, currency: Currency, tx: Tx): Promise<WalletAccount> {
    const existing = await tx.walletAccount.findFirst({ where: { userId, type: 'USER', currency } });
    return existing ?? tx.walletAccount.create({ data: { userId, type: 'USER', currency } });
  }

  /**
   * Persist a BALANCED transaction + its ledger entries and update cached
   * balances. `reference` is unique → duplicate posts collide (P2002), giving
   * ledger-level idempotency. `enabled` gates real money movement (M12 passes
   * true only for the sanctioned customer↔escrow operations).
   */
  async postTransaction(tx: Tx, draft: DraftTransaction & { reference: string }, enabled: boolean, isTest = false) {
    assertMoneyMovementEnabled(enabled); // hard gate — off for foundation phases
    assertBalanced(draft); // throws LedgerError unless debits == credits, net 0
    const transaction = await tx.walletTransaction.create({
      data: {
        type: draft.type,
        status: 'POSTED',
        currency: draft.currency,
        // Inherited from the account owner by the caller, never from a request.
        isTest,
        reference: draft.reference,
        description: draft.description ?? null,
        postedAt: new Date(),
        entries: { create: draft.lines.map((l) => ({ accountId: l.accountId, direction: l.direction, amountMinor: l.amountMinor })) },
      },
      include: { entries: true },
    });
    for (const line of draft.lines) {
      await tx.walletAccount.update({ where: { id: line.accountId }, data: { cachedBalanceMinor: { increment: signedAmount(line) } } });
    }
    return transaction;
  }

  // ---- Funding ----

  /**
   * Put money into a user's wallet.
   *
   * Posts a real, balanced TOPUP through the same engine everything else uses:
   * the customer's account is CREDITED and the topup clearing account is
   * DEBITED. There is no shortcut here — no direct balance write, no ledger
   * bypass — because the whole point of a rehearsal is to exercise the
   * accounting, not to route around it.
   *
   * `isTest` is read from the USER, never from the caller. A customer cannot
   * hand us a flag that mints them money.
   */
  async topUp(
    userId: string,
    amountMinor: bigint,
    currency: Currency,
    opts: { reference: string; description: string; actorId?: string | null },
  ) {
    if (amountMinor <= 0n) throw new BadRequestException('Enter an amount greater than zero.');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isTest: true } });
    if (!user) throw new NotFoundException('Account not found.');

    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await this.ensureUserAccount(userId, currency, tx);
      if (wallet.status !== 'ACTIVE') throw new BadRequestException('This wallet is not active.');
      const clearing = await this.ensureSystemAccount('SYSTEM_TOPUP_CLEARING', currency, tx);

      const txn = await this.postTransaction(
        tx,
        {
          type: 'TOPUP',
          currency,
          // Unique, so a retried request lands once rather than twice.
          reference: opts.reference,
          description: opts.description,
          lines: [
            { accountId: wallet.id, direction: 'CREDIT', amountMinor },
            { accountId: clearing.id, direction: 'DEBIT', amountMinor },
          ],
        },
        true,
        user.isTest,
      );
      return { txn, walletId: wallet.id };
    });

    await this.audit.record({
      action: 'WALLET_TOPUP_POSTED',
      actorId: opts.actorId ?? userId,
      targetUserId: userId,
      newValue: { walletTransactionId: result.txn.id, amountMinor: money(amountMinor), currency, isTest: user.isTest },
    });
    return this.summary(userId, currency);
  }

  // ---- Reads ----

  /**
   * What the customer sees on the Wallet screen.
   *
   * Three numbers that have to add up, and mean what they say:
   *
   *   available — what can be spent right now
   *   on hold   — committed to orders in flight
   *   total     — the two together
   *
   * The subtlety is that a wallet hold has two lives. A HELD hold is intent
   * only: no money has moved, so the funds are still sitting in the ledger
   * balance and must be SUBTRACTED to get what is genuinely spendable. An
   * AUTHORIZED hold has already been debited into escrow, so it has left the
   * balance and must be ADDED BACK to show the customer their money still
   * exists. Getting this wrong in either direction shows somebody the wrong
   * number about their own money.
   */
  async summary(userId: string, currency: Currency = 'BZD') {
    const wallet = await this.prisma.walletAccount.findFirst({ where: { userId, type: 'USER', currency } });
    if (!wallet) {
      return { currency, availableMinor: 0, onHoldMinor: 0, totalMinor: 0, status: 'ACTIVE' as const, exists: false };
    }
    const ledgerBalance = await this.balanceMinor(wallet.id);
    const holds = await this.prisma.walletHold.groupBy({
      by: ['status'],
      where: { walletAccountId: wallet.id, status: { in: ['HELD', 'AUTHORIZED'] } },
      _sum: { amountMinor: true },
    });
    const sum = (status: string) => holds.find((h) => h.status === status)?._sum.amountMinor ?? 0n;
    const soft = sum('HELD');
    const escrowed = sum('AUTHORIZED');

    const available = ledgerBalance - soft;
    return {
      currency,
      // Never show a negative available balance: it would be alarming and, given
      // authorization checks the ledger in-transaction, it should be impossible.
      availableMinor: money(available > 0n ? available : 0n),
      onHoldMinor: money(soft + escrowed),
      totalMinor: money((available > 0n ? available : 0n) + soft + escrowed),
      status: wallet.status,
      exists: true,
    };
  }

  /** The customer's own transaction history, newest first. */
  async listForUser(userId: string, take = 50) {
    const rows = await this.prisma.walletTransaction.findMany({
      where: { entries: { some: { account: { userId } } } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { entries: { include: { account: { select: { id: true, type: true, userId: true } } } } },
    });
    return rows.map((t) => {
      const mine = t.entries.filter((e) => e.account.userId === userId);
      // Signed from the CUSTOMER's point of view: a credit to their account is
      // money in, a debit is money out. The raw entries are symmetrical; the
      // customer only cares about their own side of them.
      const signedMinor = mine.reduce((acc, e) => acc + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        currency: t.currency,
        description: t.description,
        isTest: t.isTest,
        signedMinor: money(signedMinor),
        direction: signedMinor >= 0n ? ('IN' as const) : ('OUT' as const),
        postedAt: t.postedAt,
        createdAt: t.createdAt,
      };
    });
  }


  /** A wallet transaction the caller is party to (owns one of the entry accounts). */
  async getForUser(userId: string, transactionId: string) {
    const t = await this.prisma.walletTransaction.findUnique({
      where: { id: transactionId },
      include: { entries: { include: { account: { select: { id: true, type: true, userId: true, currency: true } } } } },
    });
    if (!t || !t.entries.some((e) => e.account.userId === userId)) throw new NotFoundException('Wallet transaction not found.');
    return this.shape(t);
  }

  async adminList() {
    const rows = await this.prisma.walletTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { entries: { include: { account: { select: { type: true, userId: true } } } } },
    });
    return rows.map((t) => this.shape(t));
  }

  /** Escrow + system account balances (read-only). */
  async adminAccounts() {
    const rows = await this.prisma.walletAccount.findMany({ where: { userId: null }, orderBy: { type: 'asc' } });
    return rows.map((a) => ({ id: a.id, type: a.type, currency: a.currency, status: a.status, cachedBalanceMinor: money(a.cachedBalanceMinor) }));
  }

  private shape(t: {
    id: string; type: string; status: string; currency: string; reference: string | null; description: string | null; postedAt: Date | null; createdAt: Date;
    entries: Array<{ id: string; direction: string; amountMinor: bigint; account: { type: string; userId: string | null } }>;
  }) {
    return {
      id: t.id,
      type: t.type,
      status: t.status,
      currency: t.currency,
      reference: t.reference,
      description: t.description,
      postedAt: t.postedAt,
      createdAt: t.createdAt,
      entries: t.entries.map((e) => ({ direction: e.direction, amountMinor: money(e.amountMinor), accountType: e.account.type, isCustomer: !!e.account.userId })),
      balanced: t.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n) === 0n,
    };
  }
}
