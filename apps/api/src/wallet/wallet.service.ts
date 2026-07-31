import { Injectable, NotFoundException } from '@nestjs/common';
import { assertBalanced, assertMoneyMovementEnabled, signedAmount, type DraftTransaction } from '@bmpl/wallet';
import type { Currency, Prisma, WalletAccount, WalletAccountType } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * Persist a BALANCED transaction + its ledger entries and update cached
   * balances. `reference` is unique → duplicate posts collide (P2002), giving
   * ledger-level idempotency. `enabled` gates real money movement (M12 passes
   * true only for the sanctioned customer↔escrow operations).
   */
  async postTransaction(tx: Tx, draft: DraftTransaction & { reference: string }, enabled: boolean) {
    assertMoneyMovementEnabled(enabled); // hard gate — off for foundation phases
    assertBalanced(draft); // throws LedgerError unless debits == credits, net 0
    const transaction = await tx.walletTransaction.create({
      data: {
        type: draft.type,
        status: 'POSTED',
        currency: draft.currency,
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

  // ---- Reads ----

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
