/**
 * The wallet, actually used to buy something.
 *
 * The engine — double-entry ledger, escrow, holds, idempotency by reference —
 * was already built and already tested. What was missing was every way IN: no
 * balance to read, no history to show, and no way to put money in at all. A
 * customer therefore reached checkout with an empty wallet, authorization
 * refused for insufficient funds, and the order was cancelled a moment after
 * being created.
 *
 * This suite covers the activation: funding that goes through the real ledger,
 * a checkout that pays atomically, and — the part that matters most — a failure
 * that leaves nothing behind.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

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

/** A customer an administrator has designated as a simulation account. */
async function makeTestCustomer() {
  const c = await registerCustomer(`wtest_${uniq()}@example.com`);
  const r = await post(admin, 'admin/users/test-flag', { userId: c.userId, isTest: true, reason: 'Wallet activation testing.' });
  expect(r.status).toBe(201);
  return c;
}

async function makeVendor() {
  const s = uniq();
  const { userId } = await registerCustomer(`wv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId, isTest: false, businessName: `Store ${s}`, slug: `w-store-${s}`, contactEmail: `wv${s}@example.com`,
      approvalStatus: 'APPROVED', storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '12 Freetown Road', city: 'Belize City', district: 'BELIZE', latitude: 17.4995, longitude: -88.1976, isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id, categoryId, title: `Product ${s}`, slug: `w-prod-${s}`, sku: `W-${s}`,
      status: 'PUBLISHED', priceMinor: 2500n, currency: 'BZD',
      inventory: { create: { quantity: 100, reserved: 0 } },
    },
  });
  return { vendorProfileId: vp.id, productId: product.id };
}

const ADDRESS = {
  fullName: 'Test Customer', phone: '501-222-3333', addressLine1: '5 Barrack Road',
  city: 'Belize City', district: 'BELIZE', latitude: 17.4995, longitude: -88.1976,
};

/** Put one unit of a vendor's product in the cart. */
async function addToCart(cookies: string[], productId: string, quantity = 1) {
  const r = await post(cookies, 'cart/items', { productId, quantity });
  expect(r.status).toBeLessThan(400);
}

async function checkout(cookies: string[], vendorProfileId: string, payWithWallet: boolean) {
  return post(cookies, 'checkout', {
    vendors: [{ vendorProfileId, deliveryMethod: 'DELIVERY' }],
    deliveryAddress: ADDRESS,
    payWithWallet,
  });
}

/** Sum of every ledger entry, signed. Must be zero across the whole system. */
async function ledgerNet(): Promise<bigint> {
  const entries = await ctx.prisma.walletLedgerEntry.findMany({ select: { direction: true, amountMinor: true } });
  return entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
}

const walletOf = (userId: string) =>
  ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER', currency: 'BZD' } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const cat = await ctx.prisma.category.create({ data: { name: `Wallet ${uniq()}`, slug: `wallet-${uniq()}`, isVisible: true } });
  categoryId = cat.id;
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  // Counts are load-bearing in this suite ("no order was created", "exactly one
  // escrow transaction"), so each test starts from an empty financial world.
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.orderDelivery.deleteMany();
  await ctx.prisma.orderItem.deleteMany();
  await ctx.prisma.vendorOrder.deleteMany();
  await ctx.prisma.orderAddress.deleteMany();
  await ctx.prisma.order.deleteMany();
  await ctx.prisma.walletAccount.updateMany({ data: { cachedBalanceMinor: 0n } });
});

/* ------------------------------------------------------------------------- */

describe('reading a wallet', () => {
  it('shows zeros for a brand-new customer', async () => {
    // Registration already opens an empty BZD wallet, so the honest reading is
    // "you have a wallet and there is nothing in it" — not "no wallet".
    const c = await registerCustomer(`wnew_${uniq()}@example.com`);
    const r = await get(c.cookies, 'wallet');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ currency: 'BZD', availableMinor: 0, onHoldMinor: 0, totalMinor: 0, status: 'ACTIVE' });
  });

  it('keeps one customer out of another customer\'s wallet', async () => {
    const a = await makeTestCustomer();
    await post(a.cookies, 'wallet/top-up', { amountMinor: 5000 });
    const b = await registerCustomer(`wother_${uniq()}@example.com`);
    // There is no route that takes a user id at all — a customer can only ever
    // read their own. The proof is that B sees B's wallet, not A's.
    const r = await get(b.cookies, 'wallet');
    expect(r.body.availableMinor).toBe(0);
  });

  it('requires a session', async () => {
    expect((await request(ctx.server).get('/api/wallet')).status).toBe(401);
    expect((await request(ctx.server).post('/api/wallet/top-up').send({ amountMinor: 1000 })).status).toBe(401);
  });
});

describe('funding a wallet', () => {
  it('refuses an ordinary customer, and says why in plain words', async () => {
    // THE safeguard. Test funding is gated on a flag only an administrator can
    // set, so a real customer cannot reach it however they call it.
    const c = await registerCustomer(`wreal_${uniq()}@example.com`);
    const r = await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('not available yet');
    expect(await ledgerNet()).toBe(0n);
    // The wallet exists (registration opened it) but nothing was ever posted to it.
    const wallet = await walletOf(c.userId);
    expect(await ctx.prisma.walletLedgerEntry.count({ where: { accountId: wallet.id } })).toBe(0);
  });

  it('will not let a customer make themselves a test account', async () => {
    const c = await registerCustomer(`wself_${uniq()}@example.com`);
    const r = await post(c.cookies, 'admin/users/test-flag', { userId: c.userId, isTest: true, reason: 'Let me in.' });
    expect([401, 403]).toContain(r.status);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).isTest).toBe(false);
  });

  it('credits a designated test account through the real ledger', async () => {
    const c = await makeTestCustomer();
    const r = await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    expect(r.status).toBe(201);
    expect(r.body.availableMinor).toBe(10000);

    // Not a balance write — a balanced, posted, double-entry transaction.
    const wallet = await walletOf(c.userId);
    const txns = await ctx.prisma.walletTransaction.findMany({ where: { type: 'TOPUP' }, include: { entries: true } });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.status).toBe('POSTED');
    expect(txns[0]!.isTest).toBe(true);
    const net = txns[0]!.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
    expect(txns[0]!.entries.find((e) => e.accountId === wallet.id)!.direction).toBe('CREDIT');
    expect(await ledgerNet()).toBe(0n);
  });

  it('records the funding in the audit trail', async () => {
    const c = await makeTestCustomer();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 2500 });
    const actions = (await ctx.prisma.auditLog.findMany({ where: { targetUserId: c.userId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toContain('WALLET_TEST_FUNDING_GRANTED');
    expect(actions).toContain('WALLET_TOPUP_POSTED');
  });

  it('refuses a zero or negative amount', async () => {
    const c = await makeTestCustomer();
    expect((await post(c.cookies, 'wallet/top-up', { amountMinor: 0 })).status).toBe(400);
    expect((await post(c.cookies, 'wallet/top-up', { amountMinor: -5000 })).status).toBe(400);
  });

  it('shows the top-up in the customer\'s own history, from their point of view', async () => {
    const c = await makeTestCustomer();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 7500 });
    const r = await get(c.cookies, 'wallet/transactions');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ type: 'TOPUP', direction: 'IN', signedMinor: 7500, isTest: true });
  });
});

describe('paying for an order from the wallet', () => {
  it('places the order and moves the money, in one step', async () => {
    // TEST 1 of the matrix: sufficient balance.
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    await addToCart(c.cookies, v.productId);

    const r = await checkout(c.cookies, v.vendorProfileId, true);
    expect(r.status).toBe(201);
    // The order is ACTIVE, not cancelled — the whole point.
    expect(r.body.status).not.toBe('CANCELLED');

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: r.body.id } });
    expect(payment.status).toBe('AUTHORIZED');

    // The money genuinely left the customer and reached escrow.
    const wallet = await walletOf(c.userId);
    const escrow = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_ESCROW', currency: 'BZD' } });
    const balanceOf = async (id: string) => {
      const es = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: id }, select: { direction: true, amountMinor: true } });
      return es.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    };
    expect(await balanceOf(wallet.id)).toBe(10000n - payment.amountMinor);
    expect(await balanceOf(escrow.id)).toBe(payment.amountMinor);
    expect(await ledgerNet()).toBe(0n);
  });

  it('marks the escrow movement as test money for a test customer', async () => {
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    await addToCart(c.cookies, v.productId);
    await checkout(c.cookies, v.vendorProfileId, true);

    const escrowTxn = await ctx.prisma.walletTransaction.findFirstOrThrow({ where: { type: 'ESCROW_HOLD' } });
    // Rehearsal money stays labelled all the way through, so real reporting can
    // exclude it without having to reason about where it came from.
    expect(escrowTxn.isTest).toBe(true);
  });

  it('shows the held funds as on-hold, not as spendable', async () => {
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    await addToCart(c.cookies, v.productId);
    const r = await checkout(c.cookies, v.vendorProfileId, true);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: r.body.id } });

    const summary = (await get(c.cookies, 'wallet')).body;
    expect(summary.onHoldMinor).toBe(Number(payment.amountMinor));
    expect(summary.availableMinor).toBe(10000 - Number(payment.amountMinor));
    // The customer's money still exists — it is committed, not gone.
    expect(summary.totalMinor).toBe(10000);
  });
});

describe('when the customer cannot pay', () => {
  it('creates NO order at all, and moves no money', async () => {
    // TEST 2 of the matrix. The old behaviour created an order and cancelled it
    // moments later, which is how a customer ends up staring at CANCELLED with
    // no idea why. Rolling the whole transaction back is kinder and simpler.
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 1000 }); // BZD 10, order needs ~30
    await addToCart(c.cookies, v.productId);

    const before = await ctx.prisma.order.count();
    const r = await checkout(c.cookies, v.vendorProfileId, true);
    expect(r.status).toBeGreaterThanOrEqual(400);

    expect(await ctx.prisma.order.count()).toBe(before);
    expect(await ctx.prisma.payment.count({ where: { status: 'AUTHORIZED' } })).toBe(0);
    expect(await ledgerNet()).toBe(0n);
    // And the balance is untouched.
    expect((await get(c.cookies, 'wallet')).body.availableMinor).toBe(1000);
  });

  it('leaves no reservation, no vendor order and no delivery behind', async () => {
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 500 });
    await addToCart(c.cookies, v.productId);
    await checkout(c.cookies, v.vendorProfileId, true);

    expect(await ctx.prisma.vendorOrder.count()).toBe(0);
    expect(await ctx.prisma.orderDelivery.count()).toBe(0);
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: v.productId } });
    expect(inv.reserved).toBe(0);
  });

  it('lets the customer top up and try again successfully', async () => {
    // TEST 4 of the matrix: retry after funding.
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 500 });
    await addToCart(c.cookies, v.productId);
    expect((await checkout(c.cookies, v.vendorProfileId, true)).status).toBeGreaterThanOrEqual(400);

    // The cart survives a failed checkout, so the retry is one more tap.
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    const retry = await checkout(c.cookies, v.vendorProfileId, true);
    expect(retry.status).toBe(201);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: retry.body.id } });
    expect(payment.status).toBe('AUTHORIZED');
    expect(await ledgerNet()).toBe(0n);
  });
});

describe('paying twice is not possible', () => {
  it('replays rather than double-debiting when authorize is repeated', async () => {
    // TEST 3 of the matrix. The ledger reference is unique, so a duplicate
    // authorize collides at the database rather than moving money twice.
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    await addToCart(c.cookies, v.productId);
    const r = await checkout(c.cookies, v.vendorProfileId, true);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: r.body.id } });

    const again = await post(c.cookies, `payments/${payment.id}/authorize`);
    expect(again.status).toBeLessThan(400);

    const escrowTxns = await ctx.prisma.walletTransaction.count({ where: { type: 'ESCROW_HOLD' } });
    expect(escrowTxns).toBe(1);
    const summary = (await get(c.cookies, 'wallet')).body;
    expect(summary.availableMinor).toBe(10000 - Number(payment.amountMinor));
  });

  it('keeps the unpaid checkout path exactly as it was', async () => {
    // Regression guard: omitting payWithWallet must behave as before —
    // PENDING payment, soft hold, no money moved.
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 10000 });
    await addToCart(c.cookies, v.productId);
    const r = await checkout(c.cookies, v.vendorProfileId, false);
    expect(r.status).toBe(201);

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: r.body.id } });
    expect(payment.status).toBe('PENDING');
    const holds = await ctx.prisma.walletHold.findMany({ where: { paymentId: payment.id } });
    expect(holds.every((h) => h.status === 'HELD')).toBe(true);
    expect(await ctx.prisma.walletTransaction.count({ where: { type: 'ESCROW_HOLD' } })).toBe(0);

    // A soft hold reduces what is spendable without having moved anything.
    const summary = (await get(c.cookies, 'wallet')).body;
    expect(summary.availableMinor).toBe(10000 - Number(payment.amountMinor));
    expect(summary.onHoldMinor).toBe(Number(payment.amountMinor));
    expect(summary.totalMinor).toBe(10000);
  });
});

describe('the ledger stays honest', () => {
  it('nets to zero across funding, payment and a failed attempt', async () => {
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 20000 });
    await addToCart(c.cookies, v.productId);
    await checkout(c.cookies, v.vendorProfileId, true);
    await addToCart(c.cookies, v.productId);
    await checkout(c.cookies, v.vendorProfileId, true);

    const poor = await makeTestCustomer();
    await addToCart(poor.cookies, v.productId);
    await checkout(poor.cookies, v.vendorProfileId, true); // fails, no funds

    expect(await ledgerNet()).toBe(0n);
    // Every posted transaction balances on its own, not just in aggregate.
    const txns = await ctx.prisma.walletTransaction.findMany({ include: { entries: true } });
    for (const t of txns) {
      const net = t.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
      expect(net, `transaction ${t.id} (${t.type})`).toBe(0n);
    }
  });

  it('never lets a wallet go negative', async () => {
    const c = await makeTestCustomer();
    const v = await makeVendor();
    await post(c.cookies, 'wallet/top-up', { amountMinor: 3000 });
    // Try to spend more than exists, repeatedly.
    for (let i = 0; i < 3; i++) {
      await addToCart(c.cookies, v.productId, 5);
      await checkout(c.cookies, v.vendorProfileId, true);
    }
    const wallet = await walletOf(c.userId);
    const entries = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: wallet.id }, select: { direction: true, amountMinor: true } });
    const balance = entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(balance).toBeGreaterThanOrEqual(0n);
  });

  it('keeps test money separable from real money', async () => {
    const testCustomer = await makeTestCustomer();
    await post(testCustomer.cookies, 'wallet/top-up', { amountMinor: 5000 });

    const testMoney = await ctx.prisma.walletTransaction.count({ where: { isTest: true } });
    const realMoney = await ctx.prisma.walletTransaction.count({ where: { isTest: false } });
    expect(testMoney).toBeGreaterThan(0);
    // Real reporting filters on this flag; nothing in this suite created real money.
    expect(realMoney).toBe(0);
  });
});

describe('the boundaries around other people\u2019s money', () => {
  it('will not hand one customer another customer\u2019s transaction by id', async () => {
    // The list endpoint is scoped by query. The single-transaction endpoint is
    // scoped by a check, which is the kind of thing that gets refactored away.
    const owner = await makeTestCustomer();
    await post(owner.cookies, 'wallet/top-up', { amountMinor: 5000 });
    const mine = await get(owner.cookies, 'wallet/transactions');
    const id = mine.body[0].id;

    const stranger = await registerCustomer(`stranger_${uniq()}@example.com`);
    const peek = await get(stranger.cookies, `wallet/transactions/${id}`);
    expect(peek.status).toBe(404);

    const own = await get(owner.cookies, `wallet/transactions/${id}`);
    expect(own.status).toBe(200);
  });

  it('will not let an administrator without the permission designate test accounts', async () => {
    // Designating a test account is what unlocks funding. If a weaker admin role
    // could set it, the funding gate would be decorative.
    const weak = await seedLimitedAdmin(ctx.prisma, `weakadmin_${uniq()}@example.com`, ['users.read']);
    const login = await request(ctx.server).post('/api/auth/login').send({ email: weak.email, password: weak.password });
    const cookies = cookiesOf(login);

    const victim = await registerCustomer(`victim_${uniq()}@example.com`);
    const res = await post(cookies, 'admin/users/test-flag', { userId: victim.userId, isTest: true, reason: 'nope' });
    expect(res.status).toBe(403);

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: victim.userId }, select: { isTest: true } });
    expect(after.isTest).toBe(false);
  });

  it('never alters the balance of a real customer who was not part of any of this', async () => {
    // The plain-language version of the rule: a real person's financial records
    // are not touched to make a simulation work.
    const real = await registerCustomer(`real_${uniq()}@example.com`);
    const before = await walletOf(real.userId);

    // A full funded run by somebody else, start to finish.
    const tester = await makeTestCustomer();
    const v = await makeVendor();
    await post(tester.cookies, 'wallet/top-up', { amountMinor: 50_000 });
    await addToCart(tester.cookies, v.productId, 1);
    await checkout(tester.cookies, v.vendorProfileId, true);

    const after = await walletOf(real.userId);
    expect(after.balanceMinor).toBe(before.balanceMinor);

    const touched = await ctx.prisma.walletLedgerEntry.count({ where: { account: { userId: real.userId } } });
    expect(touched).toBe(0);

    const summary = await get(real.cookies, 'wallet');
    expect(summary.body.availableMinor).toBe(0);
    expect(summary.body.onHoldMinor).toBe(0);
  });

  it('refuses to fund a real customer even through the administrator path', async () => {
    // There is no admin "credit this wallet" route, and the only funding route
    // checks the flag on the CALLER, not on a target. Both halves matter.
    const real = await registerCustomer(`realtwo_${uniq()}@example.com`);
    const denied = await post(real.cookies, 'wallet/top-up', { amountMinor: 10_000 });
    expect(denied.status).toBe(403);

    const adminAttempt = await post(admin, 'wallet/top-up', { amountMinor: 10_000 });
    // An administrator is not a test account either; the gate is not a role check.
    expect(adminAttempt.status).toBe(403);

    const entries = await ctx.prisma.walletLedgerEntry.count({ where: { account: { userId: real.userId } } });
    expect(entries).toBe(0);
  });
});
