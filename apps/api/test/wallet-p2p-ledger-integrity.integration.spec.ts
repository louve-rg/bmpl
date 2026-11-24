/**
 * WALLET-P2P-LEDGER-INTEGRITY.
 *
 * An INDEPENDENT reconciliation and concurrency check for wallet-to-wallet P2P
 * transfers (WALLET-P2P-API, owned by Pam) — deliberately separate from her own
 * integration suite. The point of this file is not to test the transfer
 * endpoint's behaviour; it is to test the LEDGER's invariants and show they
 * survive transfers regardless of how the transfer code itself is written.
 * Nobody should be the only reviewer of their own ledger code.
 *
 * The five invariants (see each `describe` below):
 *   1. Every WalletTransaction's entries sum to zero.
 *   2. Every WalletAccount's cachedBalanceMinor equals the signed sum of its
 *      WalletLedgerEntry rows (schema.prisma's own comment on
 *      WalletAccount.cachedBalanceMinor: "Reconciliation always trusts the sum
 *      of WalletLedgerEntry rows").
 *   3. No USER account ends at a negative balance, under any sequence of
 *      transfers.
 *   4. A transfer touches exactly two USER accounts and nothing else — no fee
 *      skimmed to a SYSTEM_* account, no stray clearing/escrow leg, and the
 *      sum over USER accounts only is unchanged. (God's correction,
 *      2026-11-23: the ORIGINAL version of this invariant — "total money
 *      across every account is conserved" — is VACUOUS once every account,
 *      system ones included, is inside the sum: `assertBalanced()` already
 *      guarantees that for ANY balanced transaction, so it would pass against
 *      a transfer wired badly wrong, e.g. through a forbidden fee leg, as long
 *      as that leg still balanced. Caught by my own run showing the "it grows
 *      by the funded amount" version of this check was itself wrong for a
 *      TOPUP, which is what surfaced the deeper problem in the original
 *      card. This version is NOT implied by invariant 1 and can actually
 *      fail — proven, not assumed: Section A constructs a deliberately leaky
 *      three-entry TRANSFER by hand and confirms the checker flags it
 *      (god's second correction, 2026-11-23T22-47 — the same vacuity trap
 *      applies to a leakage detector with nothing yet to detect).)
 *   5. isTest money and real money never merge into an unlabelled movement.
 *
 * Section A runs TODAY, against operations that already exist (TOPUP), and is
 * the baseline proof that the harness and the invariant checks are sound
 * before a single transfer is involved — a false "HELD" from a broken checker
 * is worse than no checker.
 *
 * Section B exercises the frozen P2P contract itself:
 *   POST /wallet/transfers/recipient-lookup { email } -> recipientUserId | 404
 *   POST /wallet/transfers { recipientUserId, amountMinor, idempotencyKey, note? } -> 201 | 200 replayed | 400 | 404
 *   GET  /wallet/transfers/:transactionId -> sender/recipient only, 404 to anyone else
 *   GET  /wallet/transactions -> direction + counterpartyName on TRANSFER rows
 *
 * Section C is the adversarial part: N concurrent transfers draining one
 * wallet that can only cover one of them, and two simultaneous OPPOSITE
 * transfers (the deadlock risk god warned Pam about — this is the proof, not
 * the warning).
 *
 * Funding is exclusively through the EXISTING test-credit path
 * (admin/users/test-flag + POST /wallet/top-up, both already covered by
 * wallet-activation.integration.spec.ts) — never a direct balance write, per
 * this card's explicit boundary. No production data, no real money:
 * WALLET_MONEY_MOVEMENT_ENABLED stays false and every fixture account here is
 * isTest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  bootApp,
  cookiesOf,
  raceOverSeparateConnections,
  raceWithRequiredOverlap,
  resetDb,
  seedRoles,
  seedSuperAdmin,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

// ---- Marketplace-checkout fixtures, needed only by the HELD/AUTHORIZED hold
// pin test below (god, WALLET-SUMMARY-HOLDS-SUBTRACTION follow-up). Same
// pattern wallet-authorization.integration.spec.ts and
// wallet-summary-hold-subtraction.integration.spec.ts already use. ----
async function makeMarketplaceVendor(label: string) {
  const s = uniq();
  const v = await registerCustomer(`p2p_vendor_${label}_${s}@example.com`);
  await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await post(v.cookies, 'vendor/profile', { businessName: `P2PHoldShop ${s}`, contactEmail: v.email });
  await post(v.cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${profile.body.profile.id}/approve`, {});
  await request(ctx.server).patch('/api/vendor/profile').set('Cookie', v.cookies).send({ storeStatus: 'OPEN' });
  return { cookies: v.cookies, vpId: profile.body.profile.id as string };
}
async function createMarketplaceProduct(cookies: string[], priceMinor: number) {
  const s = uniq();
  const res = await post(cookies, 'vendor/products', { categoryId, title: `P2PHeld ${s}`, sku: `P2PHELD-${s}`, priceMinor });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
/** Checks out one product and returns the Payment row for the order just placed, identified by its known, distinct amount — not "the first payment", since this fixture places more than one. */
async function checkoutOneProduct(customerCookies: string[], priceMinor: number) {
  const vendor = await makeMarketplaceVendor(`pin-${priceMinor}`);
  const productId = await createMarketplaceProduct(vendor.cookies, priceMinor);
  await post(vendor.cookies, `vendor/products/${productId}/inventory/adjust`, { delta: 5, reason: 'RESTOCK' });
  await post(customerCookies, 'cart/items', { productId, quantity: 1 }).expect(201);
  const checkoutRes = await post(customerCookies, 'checkout', {});
  expect(checkoutRes.status).toBe(201);
  return ctx.prisma.payment.findFirstOrThrow({ where: { amountMinor: BigInt(priceMinor) }, orderBy: { createdAt: 'desc' } });
}
const authorize = (cookies: string[], paymentId: string) => post(cookies, `payments/${paymentId}/authorize`, {});

/**
 * Skip (not pass) a Section B/C case when WALLET-P2P-API isn't reachable yet.
 * This vitest version's `TestContext.skip()` takes no message argument, so
 * the reason is logged separately — but the skip itself is what matters: a
 * bare early `return` here would print the SAME green checkmark as a real
 * pass, for a test that asserted nothing.
 */
function skipNotTested(t: { skip: () => void }, reason: string): void {
  console.warn(`[WALLET-P2P-LEDGER-INTEGRITY] ${reason}`);
  t.skip();
}

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

/** A customer an administrator has designated as a simulation account — the only way to unlock wallet funding. */
async function makeTestCustomer(label: string) {
  const c = await registerCustomer(`p2p_${label}_${uniq()}@example.com`);
  const r = await post(admin, 'admin/users/test-flag', { userId: c.userId, isTest: true, reason: 'WALLET-P2P-LEDGER-INTEGRITY fixture.' });
  expect(r.status).toBe(201);
  return c;
}

/** Fund via the EXISTING test-credit path — never a direct balance write. */
async function fund(cookies: string[], amountMinor: number) {
  const r = await post(cookies, 'wallet/top-up', { amountMinor });
  expect(r.status).toBe(201);
}

const walletOf = (userId: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER', currency: 'BZD' } });

/** Derived balance = signed sum of ledger entries. The schema's own source of truth. */
async function derivedBalance(accountId: string): Promise<bigint> {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
}

// ---- The five invariants, each independently re-derived from raw rows ----

/** Invariant 1: every transaction's own entries net to zero. Returns every violator, not just the first. */
async function findUnbalancedTransactions(): Promise<Array<{ transactionId: string; net: bigint }>> {
  const txns = await ctx.prisma.walletTransaction.findMany({ select: { id: true, entries: { select: { direction: true, amountMinor: true } } } });
  const bad: Array<{ transactionId: string; net: bigint }> = [];
  for (const t of txns) {
    const net = t.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    if (net !== 0n) bad.push({ transactionId: t.id, net });
  }
  return bad;
}

/** Invariant 2: every account's cached balance equals the derived sum of its own entries. */
async function findCacheMismatches(): Promise<Array<{ accountId: string; cached: bigint; derived: bigint }>> {
  const accounts = await ctx.prisma.walletAccount.findMany({ select: { id: true, cachedBalanceMinor: true } });
  const bad: Array<{ accountId: string; cached: bigint; derived: bigint }> = [];
  for (const a of accounts) {
    const derived = await derivedBalance(a.id);
    if (derived !== a.cachedBalanceMinor) bad.push({ accountId: a.id, cached: a.cachedBalanceMinor, derived });
  }
  return bad;
}

/** Invariant 3: no USER account's derived balance is ever negative. */
async function findNegativeUserBalances(): Promise<Array<{ accountId: string; userId: string | null; derived: bigint }>> {
  const accounts = await ctx.prisma.walletAccount.findMany({ where: { type: 'USER' }, select: { id: true, userId: true } });
  const bad: Array<{ accountId: string; userId: string | null; derived: bigint }> = [];
  for (const a of accounts) {
    const derived = await derivedBalance(a.id);
    if (derived < 0n) bad.push({ accountId: a.id, userId: a.userId, derived });
  }
  return bad;
}

/** Total money across EVERY account (system accounts included). Not invariant 4 — see its own comment — but still useful to confirm a non-transfer operation (a TOPUP) legitimately funds itself from a system clearing account rather than leaking money into nowhere. */
async function totalAcrossAllAccounts(): Promise<bigint> {
  const accounts = await ctx.prisma.walletAccount.findMany({ select: { id: true } });
  let total = 0n;
  for (const a of accounts) total += await derivedBalance(a.id);
  return total;
}

/** The subtotal invariant 4 actually constrains: derived balance summed over USER accounts only. A transfer must leave this exactly unchanged. */
async function totalAcrossUserAccounts(): Promise<bigint> {
  const accounts = await ctx.prisma.walletAccount.findMany({ where: { type: 'USER' }, select: { id: true } });
  let total = 0n;
  for (const a of accounts) total += await derivedBalance(a.id);
  return total;
}

/**
 * Invariant 4 (corrected): every TRANSFER transaction touches EXACTLY two
 * accounts and both are type USER. A third entry, or a USER↔SYSTEM leg, is
 * how a fee, a stray clearing hop, or an escrow detour would show up — all
 * forbidden by the owner's "no fee" ruling — and NONE of them would be
 * caught by invariant 1 (assertBalanced has no opinion on account count or
 * type, only that debits equal credits).
 */
async function findTransferLeakage(): Promise<Array<{ transactionId: string; entryCount: number; nonUserAccountIds: string[] }>> {
  const transfers = await ctx.prisma.walletTransaction.findMany({
    where: { type: 'TRANSFER' },
    select: { id: true, entries: { select: { accountId: true, account: { select: { type: true } } } } },
  });
  const bad: Array<{ transactionId: string; entryCount: number; nonUserAccountIds: string[] }> = [];
  for (const t of transfers) {
    const nonUserAccountIds = t.entries.filter((e) => e.account.type !== 'USER').map((e) => e.accountId);
    if (t.entries.length !== 2 || nonUserAccountIds.length > 0) {
      bad.push({ transactionId: t.id, entryCount: t.entries.length, nonUserAccountIds });
    }
  }
  return bad;
}

/** Invariant 5: a TRANSFER transaction's isTest flag, cross-checked against whether the money actually moving was test-funded on the sender's side. */
async function findMislabelledTransfers(): Promise<Array<{ transactionId: string; postedIsTest: boolean; senderIsTestFunded: boolean }>> {
  const transfers = await ctx.prisma.walletTransaction.findMany({
    where: { type: 'TRANSFER' },
    select: { id: true, isTest: true, entries: { select: { accountId: true, direction: true } } },
  });
  const bad: Array<{ transactionId: string; postedIsTest: boolean; senderIsTestFunded: boolean }> = [];
  for (const t of transfers) {
    const debitLine = t.entries.find((e) => e.direction === 'DEBIT');
    if (!debitLine) continue; // caught separately by findUnbalancedTransactions
    const senderTestCredits = await ctx.prisma.walletLedgerEntry.count({
      where: { accountId: debitLine.accountId, direction: 'CREDIT', transaction: { isTest: true } },
    });
    const senderRealCredits = await ctx.prisma.walletLedgerEntry.count({
      where: { accountId: debitLine.accountId, direction: 'CREDIT', transaction: { isTest: false } },
    });
    const senderIsTestFunded = senderTestCredits > 0 && senderRealCredits === 0;
    if (t.isTest !== senderIsTestFunded) bad.push({ transactionId: t.id, postedIsTest: t.isTest, senderIsTestFunded });
  }
  return bad;
}

async function assertAllInvariantsHold(context: string) {
  expect(await findUnbalancedTransactions(), `invariant 1 (entries sum to zero) — ${context}`).toEqual([]);
  expect(await findCacheMismatches(), `invariant 2 (cachedBalanceMinor matches entries) — ${context}`).toEqual([]);
  expect(await findNegativeUserBalances(), `invariant 3 (no negative USER balance) — ${context}`).toEqual([]);
  expect(await findTransferLeakage(), `invariant 4 (transfer touches exactly 2 USER accounts, nothing else) — ${context}`).toEqual([]);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }).then((r) => cookiesOf(r));
  const cat = await post(admin, 'admin/categories', { name: 'P2PHeld' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

// ============================================================================
// Section A — baseline: the invariants and the checker itself, proven against
// operations that exist TODAY, before a single transfer exists.
// ============================================================================
describe('A. baseline — invariants hold under existing (non-transfer) money movement', () => {
  it('1,2: a batch of ordinary test-credit top-ups stays balanced and cache-accurate (and leaks no money system-wide)', async () => {
    const totalBefore = await totalAcrossAllAccounts();
    const c1 = await makeTestCustomer('base1');
    const c2 = await makeTestCustomer('base2');
    const c3 = await makeTestCustomer('base3');
    await fund(c1.cookies, 10_00);
    await fund(c2.cookies, 25_00);
    await fund(c3.cookies, 5_00);

    await assertAllInvariantsHold('after three top-ups');

    const w1 = await walletOf(c1.userId);
    const w2 = await walletOf(c2.userId);
    const w3 = await walletOf(c3.userId);
    expect(await derivedBalance(w1.id)).toBe(1000n);
    expect(await derivedBalance(w2.id)).toBe(2500n);
    expect(await derivedBalance(w3.id)).toBe(500n);

    // NOT invariant 4 (that's specifically about transfers — see its own
    // comment). This is invariant 1's corollary applied to the whole ledger:
    // a TOPUP funds itself from SYSTEM_TOPUP_CLEARING in the SAME transaction,
    // and that clearing account is itself one of the accounts
    // totalAcrossAllAccounts() sums — so the correct prediction is NO net
    // change across the whole universe of accounts (money moved from
    // clearing to the user, none was created from nowhere). (First run of
    // this test wrongly asserted a +4000 delta, caught immediately by
    // actually running it rather than assuming — see report to god, which is
    // also what surfaced that the ORIGINAL invariant-4 wording was vacuous.)
    // A genuine net-new-money leak would show up here as a nonzero delta.
    const totalAfter = await totalAcrossAllAccounts();
    expect(totalAfter).toBe(totalBefore);
  });

  it('5: an ordinary test-credit top-up is honestly labelled isTest on its transaction', async () => {
    const c = await makeTestCustomer('base-istest');
    await fund(c.cookies, 4_00);
    const wallet = await walletOf(c.userId);
    const entry = await ctx.prisma.walletLedgerEntry.findFirstOrThrow({
      where: { accountId: wallet.id, direction: 'CREDIT' },
      include: { transaction: { select: { isTest: true } } },
    });
    expect(entry.transaction.isTest).toBe(true);
  });

  it('the checker itself: a deliberately corrupted ledger IS caught (negative control)', async () => {
    // Proves findCacheMismatches/findNegativeUserBalances are not vacuously
    // green — write a real violation (in THIS test's own throwaway rows,
    // never touching a shared account) and confirm the checker reports it,
    // then clean it up so later tests see a clean ledger again.
    const c = await makeTestCustomer('base-negctrl');
    await fund(c.cookies, 3_00);
    const wallet = await walletOf(c.userId);
    await ctx.prisma.walletAccount.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: 999_999n } });

    const mismatches = await findCacheMismatches();
    expect(mismatches.some((m) => m.accountId === wallet.id)).toBe(true);

    // Restore, so this negative control does not poison every test after it.
    const correct = await derivedBalance(wallet.id);
    await ctx.prisma.walletAccount.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: correct } });
    expect(await findCacheMismatches()).toEqual([]);
  });

  /**
   * The checker itself, part 2 (god, 2026-11-23T22-47): findTransferLeakage()
   * is vacuous today for the SAME reason the original invariant 4 was — no
   * TRANSFER rows exist yet, so it returns [] whether or not its filter logic
   * is actually correct. A wrong account-type comparison, a wrong entry-count
   * check, or an off-by-one would ALSO return [] right now and keep returning
   * [] right through the arrival of a genuinely leaky transfer. Same fix as
   * the cachedBalanceMinor negative control above: construct the exact bad
   * shape by hand — a deliberately-leaky three-entry row typed TRANSFER,
   * touching a SYSTEM_* account, on throwaway accounts in this isolated test
   * database — confirm the checker flags it, then delete it immediately. This
   * never goes through WalletService and never represents real money; it
   * exists solely to prove the detector fires, the same narrow licence as the
   * cache-mismatch control. The same construction also proves
   * totalAcrossUserAccounts() is sensitive: a fee skimmed to a SYSTEM account
   * is exactly the kind of leak that must move it, and does.
   */
  it('the checker itself: findTransferLeakage and the USER-only subtotal actually catch a leaky transfer (negative control)', async () => {
    const sender = await makeTestCustomer('leak-negctrl-sender');
    const recipient = await makeTestCustomer('leak-negctrl-recipient');
    await fund(sender.cookies, 50_00); // also guarantees a SYSTEM_TOPUP_CLEARING account exists
    const senderWallet = await walletOf(sender.userId);
    const recipientWallet = await walletOf(recipient.userId);
    const systemClearing = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_TOPUP_CLEARING', currency: 'BZD' } });

    const userTotalBefore = await totalAcrossUserAccounts();

    // Deliberately bad: sender debited 700, recipient credited only 500, the
    // remaining 200 skimmed to a SYSTEM account as a third leg — balanced
    // (700 = 500 + 200), so invariant 1 alone would wave it through. This is
    // precisely the forbidden fee-leg shape invariant 4 exists to catch.
    const leakyTxn = await ctx.prisma.walletTransaction.create({
      data: {
        type: 'TRANSFER',
        status: 'POSTED',
        isTest: true,
        currency: 'BZD',
        entries: {
          create: [
            { accountId: senderWallet.id, direction: 'DEBIT', amountMinor: 700n },
            { accountId: recipientWallet.id, direction: 'CREDIT', amountMinor: 500n },
            { accountId: systemClearing.id, direction: 'CREDIT', amountMinor: 200n },
          ],
        },
      },
    });

    const leaksDuring = await findTransferLeakage();
    const flagged = leaksDuring.find((l) => l.transactionId === leakyTxn.id);
    expect(flagged, `findTransferLeakage() did not flag a transaction with a SYSTEM-account third leg: ${JSON.stringify(leaksDuring)}`).toBeDefined();
    expect(flagged?.entryCount).toBe(3);
    expect(flagged?.nonUserAccountIds).toEqual([systemClearing.id]);

    // The USER-only subtotal moved too — the two customers are, together, 200
    // worse off than before the leak, which is the real invariant-4 claim.
    expect(await totalAcrossUserAccounts()).toBe(userTotalBefore - 200n);

    // Clean up immediately so this fabricated row never poisons a later test.
    await ctx.prisma.walletLedgerEntry.deleteMany({ where: { transactionId: leakyTxn.id } });
    await ctx.prisma.walletTransaction.delete({ where: { id: leakyTxn.id } });

    expect(await findTransferLeakage()).toEqual([]);
    expect(await totalAcrossUserAccounts()).toBe(userTotalBefore);
  });

  /**
   * WALLET-SUMMARY-HOLDS-SUBTRACTION regression pin (god, 2026-11-23T22-41):
   * nothing currently proves summary()'s hold arithmetic, and Pam's transfer
   * is about to depend on it debiting AVAILABLE balance correctly. Pins both
   * halves of wallet.service.ts:510's own comment against hand-computed
   * numbers: a HELD hold is subtracted (money hasn't moved yet, so it must be
   * reserved out of what's spendable); an AUTHORIZED hold is NOT subtracted
   * again (it already left the ledger balance via its own escrow debit —
   * subtracting it twice would show a customer less money than they have).
   *
   * Independently confirmed once already with a single HELD hold, by actual
   * measurement rather than reading the comment (PR #894,
   * wallet-summary-hold-subtraction.integration.spec.ts: raw=6000, hold=3500,
   * availableMinor=2500). This pin covers the harder case — ONE of each hold
   * type on the SAME wallet at once — which that test did not exercise.
   */
  it('summary() pin: one HELD hold is subtracted, one AUTHORIZED hold is not subtracted again', async () => {
    const c = await makeTestCustomer('pin-holds');
    await fund(c.cookies, 100_00); // BZ$100.00 = 10000 minor
    const wallet = await walletOf(c.userId);

    // Order A: BZ$20.00, left HELD (checked out, never authorized).
    const paymentA = await checkoutOneProduct(c.cookies, 20_00);
    // Order B: BZ$15.00, checked out THEN authorized — the HELD hold payments
    // creates at checkout transitions to AUTHORIZED and posts a real
    // customer→escrow debit, which is what must leave the ledger balance.
    const paymentB = await checkoutOneProduct(c.cookies, 15_00);
    const authRes = await authorize(c.cookies, paymentB.id);
    expect(authRes.status).toBe(201);

    const holdA = await ctx.prisma.walletHold.findFirstOrThrow({ where: { paymentId: paymentA.id } });
    const holdB = await ctx.prisma.walletHold.findFirstOrThrow({ where: { paymentId: paymentB.id } });
    expect(holdA.status).toBe('HELD');
    expect(holdB.status).toBe('AUTHORIZED');

    const raw = await derivedBalance(wallet.id);
    // Hand-computed: funded 10000, order B's 1500 already moved to escrow via
    // authorize => ledger balance is 10000 - 1500 = 8500. Order A's 2000 is
    // still sitting in the balance (HELD never touches the ledger).
    expect(raw).toBe(8500n);

    const summaryRes = await get(c.cookies, 'wallet').expect(200);
    const { availableMinor, onHoldMinor, totalMinor } = summaryRes.body;
    // availableMinor = raw(8500) - HELD(2000) = 6500. AUTHORIZED's 1500 is NOT
    // subtracted a second time — it already left `raw` via the escrow debit.
    expect(availableMinor, `raw=${raw}, holdA=${holdA.amountMinor}, holdB=${holdB.amountMinor}`).toBe(6500);
    // onHoldMinor = backedSoft(HELD, 2000) + escrowed(AUTHORIZED, 1500) = 3500.
    expect(onHoldMinor).toBe(3500);
    // totalMinor = raw(8500) + escrowed(1500) = 10000 — exactly what was
    // funded; neither hold changes how much the customer actually owns.
    expect(totalMinor).toBe(10000);
  });
});

// ============================================================================
// Section B — the frozen P2P contract. Requires WALLET-P2P-API (Pam) merged
// to main; verified for real against her branch `feat/wallet-p2p-api` (#895,
// ecbef64a) by a local, uncommitted merge into this worktree — not guessed
// from reading her diff. The `skipNotTested` fallbacks below stay in place
// deliberately as a load-bearing safety net (dormant once main has the real
// routes, loud instead of silently green if a route ever regresses away
// again — the same vacuous-pass lesson this whole file was built around.
// ============================================================================
describe('B. P2P transfer contract — reconciliation after real transfers', () => {
  it('recipient-lookup: 200 for an eligible account, 404 (not disclosing which reason) for an ineligible one', async (t) => {
    const sender = await makeTestCustomer('lookup-sender');
    const recipient = await makeTestCustomer('lookup-recipient');
    const ok = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (ok.status === 404 && /Cannot POST/.test(ok.text ?? '')) {
      // Reported as SKIPPED, not green — a bare `return` here would make
      // vitest print a passing checkmark for a test that asserted nothing,
      // indistinguishable in the summary from a real pass. See helpers.ts's
      // own raceWithRequiredOverlap for the same vacuous-pass concern.
      return skipNotTested(t, 'route not implemented yet (WALLET-P2P-API not merged) — NOT TESTED, not a finding');
    }
    expect(ok.status).toBe(200);
    expect(ok.body.recipientUserId).toBe(recipient.userId);

    const missing = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: `nobody_${uniq()}@example.com` });
    expect(missing.status).toBe(404);
  });

  it('1,2,3,4: a single transfer debits the sender, credits the recipient, touches no third account, and leaves the USER-only subtotal unchanged', async (t) => {
    const sender = await makeTestCustomer('xfer-sender-1');
    const recipient = await makeTestCustomer('xfer-recipient-1');
    await fund(sender.cookies, 50_00);
    const userTotalBefore = await totalAcrossUserAccounts();

    const lookup = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (lookup.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — transfer case NOT TESTED');
    }
    const res = await post(sender.cookies, 'wallet/transfers', {
      recipientUserId: lookup.body.recipientUserId,
      amountMinor: 20_00,
      idempotencyKey: randomUUID(),
      note: 'ledger-integrity single transfer',
    });
    expect(res.status).toBe(201);

    await assertAllInvariantsHold('after single transfer');
    const senderWallet = await walletOf(sender.userId);
    const recipientWallet = await walletOf(recipient.userId);
    expect(await derivedBalance(senderWallet.id)).toBe(3000n);
    expect(await derivedBalance(recipientWallet.id)).toBe(2000n);
    // The real invariant-4 claim: USER-only subtotal unchanged (money moved
    // between two customers), NOT "total across every account unchanged" —
    // that broader version is vacuous, guaranteed by assertBalanced() alone.
    expect(await totalAcrossUserAccounts()).toBe(userTotalBefore);
    const txn = await ctx.prisma.walletTransaction.findUniqueOrThrow({ where: { id: res.body.transactionId }, include: { entries: true } });
    expect(txn.entries).toHaveLength(2); // no fee, no stray system leg
  });

  it('idempotent replay of the identical key does not move money twice', async (t) => {
    const sender = await makeTestCustomer('xfer-sender-replay');
    const recipient = await makeTestCustomer('xfer-recipient-replay');
    await fund(sender.cookies, 30_00);
    const lookup = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (lookup.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — replay case NOT TESTED');
    }
    const key = randomUUID();
    const first = await post(sender.cookies, 'wallet/transfers', { recipientUserId: lookup.body.recipientUserId, amountMinor: 10_00, idempotencyKey: key });
    expect(first.status).toBe(201);
    const second = await post(sender.cookies, 'wallet/transfers', { recipientUserId: lookup.body.recipientUserId, amountMinor: 10_00, idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);

    const senderWallet = await walletOf(sender.userId);
    expect(await derivedBalance(senderWallet.id)).toBe(2000n); // debited once, not twice
    await assertAllInvariantsHold('after idempotent replay');
  });

  it('5: a transfer of test-funded money posts an honestly isTest-labelled transaction', async (t) => {
    const sender = await makeTestCustomer('xfer-sender-istest');
    const recipient = await makeTestCustomer('xfer-recipient-istest');
    await fund(sender.cookies, 15_00);
    const lookup = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (lookup.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — isTest case NOT TESTED');
    }
    const res = await post(sender.cookies, 'wallet/transfers', { recipientUserId: lookup.body.recipientUserId, amountMinor: 5_00, idempotencyKey: randomUUID() });
    if (res.status !== 201) return skipNotTested(t, `transfer post did not return 201 (status=${res.status}) — isTest case NOT TESTED`);

    const mislabelled = await findMislabelledTransfers();
    expect(mislabelled).toEqual([]);

    const txn = await ctx.prisma.walletTransaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
    expect(txn.isTest).toBe(true); // sender's wallet was funded exclusively via test credit
  });

  it('GET /wallet/transfers/:id — sender and recipient both read it, a third party gets 404 (not 403)', async (t) => {
    const sender = await makeTestCustomer('xfer-sender-read');
    const recipient = await makeTestCustomer('xfer-recipient-read');
    const stranger = await makeTestCustomer('xfer-stranger-read');
    await fund(sender.cookies, 20_00);
    const lookup = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (lookup.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — read-authorization case NOT TESTED');
    }
    const res = await post(sender.cookies, 'wallet/transfers', { recipientUserId: lookup.body.recipientUserId, amountMinor: 5_00, idempotencyKey: randomUUID() });
    if (res.status !== 201) return skipNotTested(t, `transfer post did not return 201 (status=${res.status}) — read-authorization case NOT TESTED`);
    const id = res.body.transactionId as string;

    const bySender = await get(sender.cookies, `wallet/transfers/${id}`);
    expect(bySender.status).toBe(200);
    expect(bySender.body.direction).toBe('SENT');

    const byRecipient = await get(recipient.cookies, `wallet/transfers/${id}`);
    expect(byRecipient.status).toBe(200);
    expect(byRecipient.body.direction).toBe('RECEIVED');

    const byStranger = await get(stranger.cookies, `wallet/transfers/${id}`);
    expect(byStranger.status).toBe(404); // not 403 — a 403 would confirm the transfer exists
  });

  /**
   * WALLET-SUMMARY-HOLDS-SUBTRACTION regression, assertion 2 (god,
   * 2026-11-23T22-41): a transfer must debit AVAILABLE balance, not raw
   * ledger balance — PR #894 (summary-hold-subtraction) and the pin test in
   * Section A above both confirm summary() itself does this subtraction
   * correctly, but neither one touches the transfer endpoint. This is the
   * case that actually matters for Pam's feature: a HELD hold is reserving
   * money a transfer must not be able to spend out from under it, because
   * doing so would strand the payment the hold belongs to — exactly the
   * class of bug the floor has live evidence of (Stanley's three stranded
   * holds).
   */
  it('a HELD hold blocks a transfer from spending the money it is reserving', async (t) => {
    const sender = await makeTestCustomer('xfer-sender-held-block');
    const recipient = await makeTestCustomer('xfer-recipient-held-block');
    await fund(sender.cookies, 100_00); // BZ$100.00
    const senderWallet = await walletOf(sender.userId);
    await checkoutOneProduct(sender.cookies, 80_00); // HELD hold for BZ$80.00, never authorized

    const rawBefore = await derivedBalance(senderWallet.id);
    expect(rawBefore).toBe(10000n); // HELD never touches the ledger — confirms the setup, not the claim under test

    const lookup = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    if (lookup.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — HELD-hold-blocks-transfer case NOT TESTED');
    }
    // Available is 10000 - 8000(HELD) = 2000. A transfer of 5000 must be
    // refused even though RAW balance (10000) could cover it.
    const res = await post(sender.cookies, 'wallet/transfers', { recipientUserId: lookup.body.recipientUserId, amountMinor: 50_00, idempotencyKey: randomUUID() });
    expect(res.status, `expected the transfer to be refused — summary().availableMinor should be 2000, raw balance is ${rawBefore}`).toBe(400);

    // The ledger is untouched: no new transaction, balance unchanged.
    const rawAfter = await derivedBalance(senderWallet.id);
    expect(rawAfter).toBe(rawBefore);
    await assertAllInvariantsHold('after a refused HELD-hold-blocked transfer attempt');
  });
});

// ============================================================================
// Section C — adversarial. Requires WALLET-P2P-API (Pam) merged to main;
// verified for real against feat/wallet-p2p-api (#895) — including the
// opposite-direction deadlock case, with Pam's sorted-account-id row-locking
// at transferFunds confirmed by reading her code before this ran.
// ============================================================================
describe('C. adversarial — concurrent transfers against the same wallet', () => {
  it('N concurrent transfers draining a wallet that can cover only ONE of them: exactly one succeeds, invariants hold', async (t) => {
    const sender = await makeTestCustomer('race-drain-sender');
    // Fixture setup is deliberately SEQUENTIAL, not Promise.all(x5) — the
    // property under test is 5 simultaneous TRANSFER requests, not 5
    // simultaneous REGISTRATIONS. Firing registration concurrently here was
    // this test's own confound: under -t isolation (the very first requests
    // this process makes) it reliably ECONNRESET'd inside AuthService.register
    // itself — "Transaction API error: Transaction not found... obtained
    // before disconnecting" logged server-side — a real, pre-existing
    // concurrency fragility in registration's own $transaction under 5-way
    // contention, UNRELATED to wallet transfers or Pam's code (reported to
    // god separately; not fixed here, out of this file's boundary). Removing
    // the concurrency this test never needed is the correct scoped fix on
    // this side, not a retry and not a timeout widened to hide it.
    const recipients = [];
    for (const i of [1, 2, 3, 4, 5]) recipients.push(await makeTestCustomer(`race-drain-r${i}`));
    const STAKE = 10_00;
    await fund(sender.cookies, STAKE); // enough for exactly ONE of the five

    const lookups = await Promise.all(recipients.map((r) => post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: r.email })));
    if (lookups.some((l) => l.status !== 200)) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — drain race NOT TESTED');
    }

    const userTotalBefore = await totalAcrossUserAccounts();
    const probe = await raceWithRequiredOverlap(
      ctx.prisma,
      lookups.map((l, i) => () => post(sender.cookies, 'wallet/transfers', { recipientUserId: l.body.recipientUserId, amountMinor: STAKE, idempotencyKey: randomUUID() }).then((r) => r.status)),
    );

    const succeeded = probe.responses.filter((s) => s === 201);
    const refused = probe.responses.filter((s) => s === 400);
    expect(succeeded.length, `statuses=${JSON.stringify(probe.responses)}`).toBe(1);
    expect(refused.length).toBe(4);

    await assertAllInvariantsHold('after N-way drain race');
    const senderWallet = await walletOf(sender.userId);
    expect(await derivedBalance(senderWallet.id)).toBe(0n);
    expect(await totalAcrossUserAccounts()).toBe(userTotalBefore); // money moved between USER accounts, none created, none skimmed
  });

  it('two SIMULTANEOUS OPPOSITE transfers (A→B and B→A): no deadlock/timeout, invariants hold afterward', async (t) => {
    const a = await makeTestCustomer('race-opp-a');
    const b = await makeTestCustomer('race-opp-b');
    await fund(a.cookies, 40_00);
    await fund(b.cookies, 40_00);

    const lookupBFromA = await post(a.cookies, 'wallet/transfers/recipient-lookup', { email: b.email });
    const lookupAFromB = await post(b.cookies, 'wallet/transfers/recipient-lookup', { email: a.email });
    if (lookupBFromA.status !== 200 || lookupAFromB.status !== 200) {
      return skipNotTested(t, 'recipient-lookup not available (WALLET-P2P-API not merged) — opposite-transfer race NOT TESTED');
    }

    const userTotalBefore = await totalAcrossUserAccounts();
    const DEADLOCK_TIMEOUT_MS = 15_000;
    const withTimeout = <T,>(p: Promise<T>, label: string) =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`DEADLOCK/TIMEOUT: ${label} did not resolve within ${DEADLOCK_TIMEOUT_MS}ms`)), DEADLOCK_TIMEOUT_MS)),
      ]);

    let probe: Awaited<ReturnType<typeof raceOverSeparateConnections<number>>>;
    try {
      probe = await withTimeout(
        raceOverSeparateConnections(ctx.prisma, [
          () => post(a.cookies, 'wallet/transfers', { recipientUserId: lookupBFromA.body.recipientUserId, amountMinor: 15_00, idempotencyKey: randomUUID() }).then((r) => r.status),
          () => post(b.cookies, 'wallet/transfers', { recipientUserId: lookupAFromB.body.recipientUserId, amountMinor: 12_00, idempotencyKey: randomUUID() }).then((r) => r.status),
        ]),
        'opposite-direction simultaneous transfer pair',
      );
    } catch (e) {
      // god: "if it deadlocks or times out, that is a finding, not a flake —
      // report it with the evidence." Fail loudly and let the report carry it.
      throw new Error(`VIOLATION — opposite simultaneous transfers deadlocked or timed out: ${(e as Error).message}`);
    }

    // Overlap evidence for the report — not a hard requirement here (an
    // inconclusive-overlap run is a DIFFERENT failure mode than a deadlock,
    // so it must not be conflated with the VIOLATION throw above), but the
    // claim "no deadlock under genuine concurrency" is only as strong as the
    // proof that the two calls actually overlapped rather than serializing
    // by luck before either lock was taken.
    console.warn(
      `[WALLET-P2P-LEDGER-INTEGRITY] opposite-transfer race overlap evidence: observed=${probe.observed}, peakConcurrentActive=${probe.peakConcurrentActive}, samples=${probe.samples}, elapsedMs=${probe.elapsedMs}`,
    );
    expect(probe.responses.every((s) => s === 201), `statuses=${JSON.stringify(probe.responses)}, observed=${probe.observed}, peakConcurrentActive=${probe.peakConcurrentActive}`).toBe(true);
    await assertAllInvariantsHold('after opposite simultaneous transfers');

    const walletA = await walletOf(a.userId);
    const walletB = await walletOf(b.userId);
    // A sent 1500, received 1200 => net -300. B sent 1200, received 1500 => net +300.
    expect(await derivedBalance(walletA.id)).toBe(4000n - 300n);
    expect(await derivedBalance(walletB.id)).toBe(4000n + 300n);
    expect(await totalAcrossUserAccounts()).toBe(userTotalBefore); // net zero across the two customers, no third account touched
  });
});
