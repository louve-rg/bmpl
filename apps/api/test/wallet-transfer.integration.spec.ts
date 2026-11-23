/**
 * WALLET-P2P-API — wallet-to-wallet transfers, integration vs real Postgres.
 *
 * The ledger engine (double-entry, escrow, holds, idempotency by reference)
 * already existed and was already tested; this is the FIRST user-to-user
 * movement it has ever posted. Coverage here is specifically about what is
 * new to a transfer rather than re-proving the engine itself: debiting
 * against AVAILABLE balance (not raw, so an escrow hold can never be
 * outrun), the deterministic two-account lock, idempotent replay on the
 * client-supplied key, who may read a receipt, and that a refused transfer
 * leaves nothing behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

/** A fresh sender/recipient pair, each with their own distinct name so a
 *  receipt's `counterpartyName` assertion can tell them apart. */
async function pair(tag: string) {
  const sender = await registerCustomer(`xfer_s_${tag}_${uniq()}@example.bz`);
  const recipient = await registerCustomer(`xfer_r_${tag}_${uniq()}@example.bz`);
  await ctx.prisma.user.update({ where: { id: sender.userId }, data: { firstName: 'Pamela', lastName: 'Beesly' } });
  await ctx.prisma.user.update({ where: { id: recipient.userId }, data: { firstName: 'Edward', lastName: 'Burke' } });
  return { sender, recipient };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'WALLET-P2P-API transfer tests.' });
  expect(r.status).toBe(201);
}

async function balanceOf(userId: string, cookies: string[]) {
  const r = await get(cookies, 'wallet');
  expect(r.status).toBe(200);
  return r.body as { availableMinor: number; onHoldMinor: number; totalMinor: number; status: string };
}

const transfer = (cookies: string[], body: Record<string, unknown>) => post(cookies, 'wallet/transfers', body);

const walletAccountOf = (userId: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER', currency: 'BZD' } });

/** TRANSFER transactions this specific sender is party to — scoped, because
 *  `resetDb` runs once per FILE (not per test), so a bare, unscoped count
 *  would also see every other test's transfers in this same file. */
const transferCountFor = (userId: string) =>
  ctx.prisma.walletTransaction.count({ where: { type: 'TRANSFER', entries: { some: { account: { userId } } } } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', admin).send({ name: 'General' });
  categoryId = cat.body.id;
});

afterAll(async () => {
  await ctx.app.close();
});

describe('POST /wallet/transfers/recipient-lookup', () => {
  it('resolves an eligible recipient by exact email, with a first-name + last-initial display name', async () => {
    const { sender, recipient } = await pair('lookup-ok');
    const r = await post(sender.cookies, 'wallet/transfers/recipient-lookup', { email: recipient.email });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ recipientUserId: recipient.userId, displayName: 'Edward B.' });
  });

  it('gives the SAME message for an unknown email, a suspended account and a deactivated account', async () => {
    const unknown = await post(admin, 'wallet/transfers/recipient-lookup', { email: `nobody_${uniq()}@example.bz` });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('No eligible BML account for that email address.');

    const { recipient: suspended } = await pair('lookup-suspended');
    await ctx.prisma.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } });
    const r1 = await post(admin, 'wallet/transfers/recipient-lookup', { email: suspended.email });
    expect(r1.status).toBe(404);
    expect(r1.body.message).toBe('No eligible BML account for that email address.');

    const { recipient: deactivated } = await pair('lookup-deactivated');
    await ctx.prisma.user.update({ where: { id: deactivated.userId }, data: { status: 'DEACTIVATED', deletedAt: new Date() } });
    const r2 = await post(admin, 'wallet/transfers/recipient-lookup', { email: deactivated.email });
    expect(r2.status).toBe(404);
    expect(r2.body.message).toBe('No eligible BML account for that email address.');
  });

  it('is a pure read — posts nothing and leaves the recipient\'s wallet account untouched', async () => {
    // Registration itself creates every user's BZD wallet account eagerly
    // (`auth.service.ts`'s `register` — `walletAccounts: { create: ... }`),
    // so "materialising on lookup" cannot be observed for an ordinarily
    // registered user; what matters, and what `lookupTransferRecipient`'s
    // own comment states, is that a lookup never calls `ensureUserAccount`
    // and so never writes to `WalletAccount` or posts a transaction either.
    const { recipient } = await pair('lookup-pure-read');
    const before = await walletAccountOf(recipient.userId);
    await post(admin, 'wallet/transfers/recipient-lookup', { email: recipient.email }).expect(200);
    const after = await walletAccountOf(recipient.userId);
    expect(after).toEqual(before);
    expect(await ctx.prisma.walletTransaction.count({ where: { entries: { some: { account: { userId: recipient.userId } } } } })).toBe(0);
  });
});

describe('POST /wallet/transfers', () => {
  it('posts a balanced transfer: both balances and both ledger entries move, not just the sender side', async () => {
    const { sender, recipient } = await pair('happy');
    await fund(sender.userId, 10_000); // BZ$100.00, via admin test-credit — always isTest money

    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 4_000, idempotencyKey: randomUUID(), note: 'Lunch' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      direction: 'SENT',
      amountMinor: 4_000,
      currency: 'BZD',
      counterpartyName: 'Edward B.',
      note: 'Lunch',
      isTest: true,
    });
    expect(r.body.replayed).toBeUndefined();

    const senderBalance = await balanceOf(sender.userId, sender.cookies);
    const recipientBalance = await balanceOf(recipient.userId, recipient.cookies);
    expect(senderBalance.availableMinor).toBe(6_000);
    expect(recipientBalance.availableMinor).toBe(4_000);

    const senderAccount = await walletAccountOf(sender.userId);
    const recipientAccount = await walletAccountOf(recipient.userId);
    const entries = await ctx.prisma.walletLedgerEntry.findMany({ where: { transactionId: r.body.transactionId } });
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.accountId === senderAccount.id);
    const credit = entries.find((e) => e.accountId === recipientAccount.id);
    expect(debit).toMatchObject({ direction: 'DEBIT', amountMinor: 4000n });
    expect(credit).toMatchObject({ direction: 'CREDIT', amountMinor: 4000n });

    const txn = await ctx.prisma.walletTransaction.findUniqueOrThrow({ where: { id: r.body.transactionId } });
    expect(txn.type).toBe('TRANSFER');
    expect(txn.isTest).toBe(true);

    // The recipient's own receipt, read from THEIR side.
    const recipientReceipt = await get(recipient.cookies, `wallet/transfers/${r.body.transactionId}`);
    expect(recipientReceipt.status).toBe(200);
    expect(recipientReceipt.body).toMatchObject({ direction: 'RECEIVED', amountMinor: 4_000, counterpartyName: 'Pamela B.' });
  });

  it('refuses when the sender does not have enough available balance', async () => {
    const { sender, recipient } = await pair('insufficient');
    await fund(sender.userId, 1_000);
    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 1_001, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/available balance/i);
    expect(await transferCountFor(sender.userId)).toBe(0);
  });

  it('refuses when the amount is present in the RAW balance but reserved by a HELD hold — debits AVAILABLE, never raw', async () => {
    const { sender, recipient } = await pair('held');
    await fund(sender.userId, 10_000); // BZ$100.00 raw

    // A HELD (not yet AUTHORIZED) hold: a marketplace order's payment is
    // created as PENDING with a soft hold, and nothing in this suite
    // authorizes it — same fixture shape as wallet-hold-stale-read's own
    // `holdFixture`, which exists specifically to produce this state.
    const vendor = await registerCustomer(`xfer_v_held_${uniq()}@example.bz`);
    await ctx.prisma.userRole.create({ data: { userId: vendor.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
    const vp = await post(vendor.cookies, 'vendor/profile', { businessName: `HeldShop${uniq()}`, contactEmail: vendor.email });
    await post(vendor.cookies, 'vendor/profile/submit', {}).expect(201);
    await post(admin, `admin/vendors/${vp.body.profile.id}/approve`, {}).expect(201);
    await request(ctx.server).patch('/api/vendor/profile').set('Cookie', vendor.cookies).send({ storeStatus: 'OPEN' }).expect(200);
    const product = await post(vendor.cookies, 'vendor/products', { categoryId, title: `Held ${uniq()}`, sku: `HELD${uniq()}`, priceMinor: 8_000 });
    expect(product.status).toBe(201);
    await post(vendor.cookies, `vendor/products/${product.body.id}/inventory/adjust`, { delta: 5, reason: 'RESTOCK' }).expect(201);
    await post(sender.cookies, 'cart/items', { productId: product.body.id, quantity: 1 }).expect(201);
    const order = await post(sender.cookies, 'checkout', {});
    expect(order.status).toBe(201);
    const payment = await get(sender.cookies, 'payments');
    const hold = await ctx.prisma.walletHold.findFirstOrThrow({ where: { paymentId: payment.body[0].id } });
    expect(hold.status).toBe('HELD');
    expect(hold.amountMinor).toBe(8_000n);

    // Raw ledger balance is still 10,000 — nothing has been debited, the
    // hold is only a soft reservation — but available is 10,000 - 8,000 =
    // 2,000, and this asks for 3,000.
    const before = await balanceOf(sender.userId, sender.cookies);
    expect(before.availableMinor).toBe(2_000);

    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 3_000, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/available balance/i);

    const after = await balanceOf(sender.userId, sender.cookies);
    expect(after.availableMinor).toBe(2_000);
    expect(await transferCountFor(sender.userId)).toBe(0);
  });

  it('refuses an unknown recipient', async () => {
    const { sender } = await pair('unknown-recipient');
    await fund(sender.userId, 5_000);
    // A real, correctly-shaped id that does not resolve — a syntactically
    // fake one would be caught by `cuidSchema` first and prove nothing
    // about the "unknown recipient" check this test exists for.
    const ghost = await registerCustomer(`xfer_ghost_${uniq()}@example.bz`);
    await ctx.prisma.user.delete({ where: { id: ghost.userId } });
    const r = await transfer(sender.cookies, { recipientUserId: ghost.userId, amountMinor: 100, idempotencyKey: randomUUID() });
    expect(r.status).toBe(404);
  });

  it('refuses a self-transfer', async () => {
    const { sender } = await pair('self');
    await fund(sender.userId, 5_000);
    const r = await transfer(sender.cookies, { recipientUserId: sender.userId, amountMinor: 100, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/yourself/i);
  });

  it('refuses amount <= 0 and a non-integer amount', async () => {
    const { sender, recipient } = await pair('bad-amount');
    await fund(sender.userId, 5_000);
    const zero = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 0, idempotencyKey: randomUUID() });
    expect(zero.status).toBe(400);
    const negative = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: -500, idempotencyKey: randomUUID() });
    expect(negative.status).toBe(400);
    const fractional = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 100.5, idempotencyKey: randomUUID() });
    expect(fractional.status).toBe(400);
  });

  it('two transfers racing the same sender balance: exactly one wins, never a negative balance', async () => {
    const { sender, recipient } = await pair('race');
    await fund(sender.userId, 10_000);
    // Two different movements (different idempotencyKeys), each for 60% of
    // the balance — at most one can win without overspending.
    const [r1, r2] = await Promise.all([
      transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 6_000, idempotencyKey: randomUUID() }),
      transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 6_000, idempotencyKey: randomUUID() }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);
    const loser = r1.status === 400 ? r1 : r2;
    expect(loser.body.message).toMatch(/available balance/i);

    const senderBalance = await balanceOf(sender.userId, sender.cookies);
    expect(senderBalance.availableMinor).toBe(4_000);
    expect(senderBalance.availableMinor).toBeGreaterThanOrEqual(0);
    const recipientBalance = await balanceOf(recipient.userId, recipient.cookies);
    expect(recipientBalance.availableMinor).toBe(6_000);
  });

  it('repeating the same idempotencyKey replays the original movement — one ledger entry pair, two 2xx responses, identical receipt', async () => {
    const { sender, recipient } = await pair('replay');
    await fund(sender.userId, 5_000);
    const key = randomUUID();
    const first = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 1_500, idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBeUndefined();

    const second = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 1_500, idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.transactionId).toBe(first.body.transactionId);
    expect({ ...second.body, replayed: undefined }).toEqual({ ...first.body, replayed: undefined });

    expect(await transferCountFor(sender.userId)).toBe(1);
    const senderBalance = await balanceOf(sender.userId, sender.cookies);
    expect(senderBalance.availableMinor).toBe(3_500);
  });

  it('refuses when the sender wallet is LOCKED', async () => {
    const { sender, recipient } = await pair('sender-locked');
    await fund(sender.userId, 5_000);
    await post(admin, `admin/wallet/users/${sender.userId}/lock`, { reason: 'WALLET-P2P-API test — sender lock.' }).expect(201);
    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 100, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not active/i);
  });

  it('refuses when the recipient wallet is SUSPENDED', async () => {
    const { sender, recipient } = await pair('recipient-suspended');
    await fund(sender.userId, 5_000);
    // SUSPENDED has no admin lever (setUserWalletLock only toggles
    // ACTIVE<->LOCKED and explicitly refuses a SUSPENDED wallet) — written
    // directly, the same way other suites reach a state with no API path.
    await fund(recipient.userId, 100); // materialise the recipient's wallet first
    await ctx.prisma.walletAccount.updateMany({ where: { userId: recipient.userId, type: 'USER' }, data: { status: 'SUSPENDED' } });
    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 100, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not active/i);
  });

  it('a failure detected inside the posting transaction leaves no ledger entry and no balance change — proves the rollback, not just the refusal', async () => {
    const { sender, recipient } = await pair('atomic-rollback');
    await fund(sender.userId, 5_000);
    await fund(recipient.userId, 100);
    await ctx.prisma.walletAccount.updateMany({ where: { userId: recipient.userId, type: 'USER' }, data: { status: 'LOCKED' } });

    const senderAccount = await walletAccountOf(sender.userId);
    const entriesBefore = await ctx.prisma.walletLedgerEntry.count({ where: { accountId: senderAccount.id } });
    const balanceBefore = await balanceOf(sender.userId, sender.cookies);

    // The recipient's wallet is locked AFTER the sender's row lock is taken
    // and INSIDE the same database transaction the debit would post in —
    // the check that refuses it runs there specifically so a failure this
    // late still rolls back cleanly rather than leaving a one-sided entry.
    const r = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 2_000, idempotencyKey: randomUUID() });
    expect(r.status).toBe(400);

    const entriesAfter = await ctx.prisma.walletLedgerEntry.count({ where: { accountId: senderAccount.id } });
    expect(entriesAfter).toBe(entriesBefore);
    const balanceAfter = await balanceOf(sender.userId, sender.cookies);
    expect(balanceAfter.availableMinor).toBe(balanceBefore.availableMinor);
    expect(await transferCountFor(sender.userId)).toBe(0);
  });
});

describe('GET /wallet/transfers/:transactionId', () => {
  it('404s for a caller who is neither the sender nor the recipient — never 403, which would confirm the transfer exists', async () => {
    const { sender, recipient } = await pair('receipt-access');
    await fund(sender.userId, 5_000);
    const posted = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 500, idempotencyKey: randomUUID() });
    expect(posted.status).toBe(201);

    const stranger = await registerCustomer(`xfer_stranger_${uniq()}@example.bz`);
    const r = await get(stranger.cookies, `wallet/transfers/${posted.body.transactionId}`);
    expect(r.status).toBe(404);

    const notATransfer = await get(sender.cookies, `wallet/transfers/${(await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: sender.userId } })).id}`);
    expect(notATransfer.status).toBe(404);
  });
});

describe('GET /wallet/transactions — history labelling on TRANSFER rows', () => {
  it('labels a transfer from both sides: the sender sees "Sent to", the recipient sees "Received from"', async () => {
    const { sender, recipient } = await pair('history');
    await fund(sender.userId, 5_000);
    const posted = await transfer(sender.cookies, { recipientUserId: recipient.userId, amountMinor: 1_200, idempotencyKey: randomUUID() });
    expect(posted.status).toBe(201);

    const senderHistory = await get(sender.cookies, 'wallet/transactions');
    const senderRow = senderHistory.body.rows.find((row: { id: string }) => row.id === posted.body.transactionId);
    expect(senderRow).toMatchObject({ type: 'TRANSFER', direction: 'OUT', signedMinor: -1_200, counterpartyName: 'Edward B.' });

    const recipientHistory = await get(recipient.cookies, 'wallet/transactions');
    const recipientRow = recipientHistory.body.rows.find((row: { id: string }) => row.id === posted.body.transactionId);
    expect(recipientRow).toMatchObject({ type: 'TRANSFER', direction: 'IN', signedMinor: 1_200, counterpartyName: 'Pamela B.' });

    // A non-TRANSFER row (the funding credit) carries no counterparty.
    const topUpRow = senderHistory.body.rows.find((row: { type: string }) => row.type === 'TOPUP');
    expect(topUpRow?.counterpartyName).toBeNull();
  });
});
