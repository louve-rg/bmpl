import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertBalanced, assertMoneyMovementEnabled, signedAmount, type DraftTransaction } from '@bmpl/wallet';
import type { Currency, Prisma, WalletAccount, WalletAccountType } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
const money = (v: bigint) => Number(v);

/**
 * The description that identifies a self-issued UAT credit, and therefore what
 * counts against a person's own allowance. Distinct from "Administrative Test
 * Credit", which an administrator grants and which does NOT consume it.
 */
export const SELF_SERVICE_TEST_CREDIT = 'Self-Service Test Credit';

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
    opts: { reference: string; description: string; actorId?: string | null; forceIsTest?: boolean },
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
        // Simulation money is a property of the CREDIT, not of the recipient. An
        // administrative test credit to a real customer is still test money, and
        // marking it from the recipient's flag would file it as real.
        opts.forceIsTest ?? user.isTest,
      );
      return { txn, walletId: wallet.id };
    });

    await this.audit.record({
      action: 'WALLET_TOPUP_POSTED',
      // Absent and explicitly-none are different claims. Omitting the actor
      // means "the account holder did this themselves", which is right for a
      // self-service top-up. Passing null means "no signed-in person did this",
      // and collapsing that to the recipient would put Edward's name on a
      // movement he did not make.
      actorId: opts.actorId === null ? null : (opts.actorId ?? userId),
      targetUserId: userId,
      newValue: { walletTransactionId: result.txn.id, amountMinor: money(amountMinor), currency, isTest: opts.forceIsTest ?? user.isTest },
    });
    return this.summary(userId, currency);
  }

  /**
   * Credit a wallet with clearly-labelled simulation money, on an
   * administrator's authority.
   *
   * This exists so a real person can exercise a real checkout without a real
   * payment rail. Everything about it is deliberately visible: it posts a
   * balanced TOPUP through the ordinary ledger (no balance is written
   * directly), the transaction is marked as test money regardless of who
   * receives it, the description says what it is in words, and the audit row
   * names the administrator and their reason.
   *
   * The recipient's own `isTest` flag is untouched — a real customer stays a
   * real customer; only this credit is simulated.
   */
  /**
   * `actorId` is the administrator who authorised this. It may be null in
   * exactly one situation: an owner-authorised maintenance operation carried
   * out while the Admin console is unreachable, where there genuinely is no
   * signed-in administrator to name. Null records that honestly rather than
   * crediting the action to someone who did not perform it — it does not
   * relax the HTTP route, which still requires `wallet.credit_test` and always
   * passes the authenticated caller.
   */
  async adminTestCredit(
    actorId: string | null,
    userId: string,
    amountMinor: bigint,
    reason: string,
    currency: Currency = 'BZD',
  ) {
    const summary = await this.topUp(userId, amountMinor, currency, {
      reference: `admin-test-credit:${userId}:${Date.now()}`,
      description: 'Administrative Test Credit',
      actorId,
      forceIsTest: true,
    });
    await this.audit.record({
      action: 'WALLET_TEST_FUNDING_GRANTED',
      actorId,
      targetUserId: userId,
      reason,
      newValue: {
        amountMinor: money(amountMinor),
        currency,
        reason,
        label: 'Administrative Test Credit',
        // Says which door this came through, so a null actor reads as a
        // recorded fact rather than missing data.
        source: actorId ? 'ADMIN_CONSOLE' : 'OWNER_AUTHORIZED_MAINTENANCE',
      },
    });
    return summary;
  }

  /**
   * TEMPORARY UAT FEATURE — MUST BE DISABLED BEFORE COMMERCIAL LAUNCH.
   *
   * Simulation money a person puts into their OWN wallet so they can exercise
   * Marketplace and Shipping without a payment rail, an administrator, or
   * working email. The recipient is always the caller: this method takes a user
   * id from the session and nothing from the request body, so there is no field
   * to tamper with to fund somebody else.
   *
   * The cap is CUMULATIVE and per person — spending does not restore headroom.
   * Getting that right under concurrency is the whole difficulty, because a
   * plain "read the total, then post" is the same check-then-act shape that let
   * a BZ$30 wallet buy three BZ$15 parcels earlier in this project. Two
   * defences, either of which is sufficient:
   *
   *   1. The wallet row is locked FOR UPDATE before the total is read, so two
   *      simultaneous claims serialise and the second sees the first's credit.
   *   2. The transaction reference is derived from how much has already been
   *      granted, and references are unique. Two racers that somehow computed
   *      the same figure would collide on the index rather than both post.
   *
   * Everything else is the ordinary engine: a balanced TOPUP through
   * `postTransaction`, marked test money, no balance column written anywhere.
   */
  async selfServiceTestCredit(userId: string, amountMinor: bigint, capMinor: bigint, currency: Currency = 'BZD') {
    if (amountMinor <= 0n) throw new BadRequestException('Enter an amount greater than zero.');

    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await this.ensureUserAccount(userId, currency, tx);
      if (wallet.status !== 'ACTIVE') throw new BadRequestException('This wallet is not active.');
      // Serialises concurrent claims on this wallet. Taken BEFORE the total is
      // read, which is the only ordering that makes the read trustworthy.
      await tx.$queryRaw`SELECT id FROM wallet_accounts WHERE id = ${wallet.id} FOR UPDATE`;

      const granted = await this.selfServiceGrantedMinor(userId, wallet.id, tx);
      const remaining = capMinor - granted;
      if (remaining <= 0n) {
        throw new ConflictException('Your test credit has already been issued.');
      }
      const credit = amountMinor < remaining ? amountMinor : remaining;

      const clearing = await this.ensureSystemAccount('SYSTEM_TOPUP_CLEARING', currency, tx);
      const txn = await this.postTransaction(
        tx,
        {
          type: 'TOPUP',
          currency,
          // Derived from what has already been granted, so a replayed request
          // lands on a reference that already exists and collides.
          reference: `self-service-test-credit:${userId}:${granted}`,
          description: SELF_SERVICE_TEST_CREDIT,
          lines: [
            { accountId: wallet.id, direction: 'CREDIT', amountMinor: credit },
            { accountId: clearing.id, direction: 'DEBIT', amountMinor: credit },
          ],
        },
        true,
        // Always simulation money, whoever receives it. The recipient's own
        // account classification is NOT read here and NOT changed: a real
        // person stays a real person and only this credit is simulated.
        true,
      );
      return { txn, walletId: wallet.id, credit, grantedAfter: granted + credit };
    }).catch((err: unknown) => {
      // The unique reference is the second line of defence, and it has to fail
      // in a way the caller can read. A racer that got past the lock — a second
      // API instance, say — collides on the index, and without this that
      // surfaces as a 500 rather than "you already have your credit". Same
      // outcome as the lock, said properly.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Your test credit has already been issued.');
      }
      throw err;
    });

    await this.audit.record({
      action: 'WALLET_SELF_SERVICE_TEST_FUNDING_GRANTED',
      // The person asked for their own test credit, so they are honestly the
      // actor. No administrator was involved and none is named.
      actorId: userId,
      targetUserId: userId,
      reason: 'Temporary UAT wallet funding',
      newValue: {
        walletId: result.walletId,
        walletTransactionId: result.txn.id,
        amountMinor: money(result.credit),
        currency,
        source: 'SELF_SERVICE_UAT',
        cumulativeMinor: money(result.grantedAfter),
      },
    });

    return {
      transactionId: result.txn.id,
      creditedMinor: money(result.credit),
      cumulativeMinor: money(result.grantedAfter),
      remainingMinor: money(capMinor - result.grantedAfter),
      wallet: await this.summary(userId, currency),
    };
  }

  /**
   * How much self-service test credit this person has already been issued.
   *
   * Counts only SELF-SERVICE credits, identified by description. An
   * administrator's grant is a different thing with a different audit action,
   * and must not eat into somebody's UAT allowance — Edward's BZ$80 stays his.
   */
  async selfServiceGrantedMinor(userId: string, walletId?: string, db: Db = this.prisma): Promise<bigint> {
    const accountId = walletId ?? (await db.walletAccount.findFirst({ where: { userId, type: 'USER', currency: 'BZD' }, select: { id: true } }))?.id;
    if (!accountId) return 0n;
    const entries = await db.walletLedgerEntry.findMany({
      where: {
        accountId,
        direction: 'CREDIT',
        transaction: { type: 'TOPUP', description: SELF_SERVICE_TEST_CREDIT },
      },
      select: { amountMinor: true },
    });
    return entries.reduce((sum, e) => sum + e.amountMinor, 0n);
  }

  /**
   * Is this wallet holding simulation money?
   *
   * True when every credit it has ever received was test money. That is the
   * honest way to classify what leaves it: simulation money is a property of
   * the MONEY, not of the person holding it. A real customer who was given
   * BZ$250 of UAT credit is still a real customer, but the BZ$250 they spend is
   * still simulated, and recording its escrow movement as real revenue is how
   * a rehearsal contaminates the books.
   *
   * A single real credit makes this false, so it turns itself off the day a
   * genuine funding rail is connected — no flag to remember to flip.
   */
  async isTestFunded(accountId: string, db: Db = this.prisma): Promise<boolean> {
    const [testCredits, realCredits] = await Promise.all([
      db.walletLedgerEntry.count({ where: { accountId, direction: 'CREDIT', transaction: { isTest: true } } }),
      db.walletLedgerEntry.count({ where: { accountId, direction: 'CREDIT', transaction: { isTest: false } } }),
    ]);
    return testCredits > 0 && realCredits === 0;
  }

  /**
   * How the money for this payment was classified when it went into escrow.
   *
   * Every later movement of the same money — releasing it, settling it, paying
   * the driver out of it — mirrors this rather than re-deriving it, so one
   * decision is made once and the whole chain agrees with itself.
   */
  async escrowIsTest(paymentId: string, db: Db = this.prisma): Promise<boolean> {
    const hold = await db.walletTransaction.findFirst({
      where: { reference: `payment:${paymentId}:auth` },
      select: { isTest: true },
    });
    return hold?.isTest ?? false;
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

    const raw = ledgerBalance - soft;
    const available = raw > 0n ? raw : 0n;

    // A soft hold reserves money the customer HAS. It cannot reserve money that
    // was never there, and reporting it as though it could is how a customer
    // with an empty wallet came to be shown "On hold BZ$55.00 · Total BZ$55.00"
    // — money that did not exist, could not be spent, and could not be got back.
    // Holds are therefore reported only up to the balance that backs them; any
    // excess is an unbacked reservation, which `expireStaleHolds` clears.
    const backedSoft = soft < ledgerBalance ? soft : ledgerBalance > 0n ? ledgerBalance : 0n;

    return {
      currency,
      availableMinor: money(available),
      onHoldMinor: money(backedSoft + escrowed),
      // What the customer actually has: their ledger balance plus anything
      // already moved into escrow on their behalf.
      totalMinor: money((ledgerBalance > 0n ? ledgerBalance : 0n) + escrowed),
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
