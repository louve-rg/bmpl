/**
 * Wallet authorization & escrow (Phase 3 · M12) — integration vs real Postgres.
 * The FIRST real money movement: customer wallet → escrow, via balanced double-
 * entry. Covers success, insufficient balance + rollback, idempotency, ledger
 * balancing, currency/locked/suspended validation, multi-vendor, and audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let topupCounter = 0;

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<string[]> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return cookiesOf(reg);
}
async function makeVendor(email: string, business: string) {
  const cookies = await registerCustomer(email);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await request(ctx.server).post('/api/vendor/profile').set('Cookie', cookies).send({ businessName: business, contactEmail: email });
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${profile.body.profile.id}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId: profile.body.profile.id, email };
}
async function createProduct(cookies: string[], fields: Record<string, unknown>) {
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ categoryId, ...fields });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const setStock = (cookies: string[], productId: string, delta: number) =>
  request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', cookies).send({ delta, reason: 'RESTOCK' }).expect(201);
const addToCart = (cookies: string[], body: Record<string, unknown>) =>
  request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body);
const checkout = (cookies: string[], body: Record<string, unknown> = {}) =>
  request(ctx.server).post('/api/checkout').set('Cookie', cookies).send(body);
const paymentOf = async (cookies: string[]) => (await request(ctx.server).get('/api/payments').set('Cookie', cookies).expect(200)).body[0];
const authorize = (cookies: string[], paymentId: string) =>
  request(ctx.server).post(`/api/payments/${paymentId}/authorize`).set('Cookie', cookies);
const reservedFor = async (productId: string) =>
  (await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } })).reserved;

/** Test fixture: fund a customer's USER/BZD wallet via a balanced TOPUP (test scaffolding). */
async function fundWallet(email: string, amountMinor: number) {
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: user.id, type: 'USER', currency: 'BZD' } });
  const clearing = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_TOPUP_CLEARING', userId: null, currency: 'BZD' } });
  topupCounter += 1;
  await ctx.prisma.walletTransaction.create({
    data: {
      type: 'TOPUP', status: 'POSTED', currency: 'BZD', reference: `test-topup-${topupCounter}`, postedAt: new Date(),
      entries: { create: [{ accountId: wallet.id, direction: 'CREDIT', amountMinor: BigInt(amountMinor) }, { accountId: clearing.id, direction: 'DEBIT', amountMinor: BigInt(amountMinor) }] },
    },
  });
  await ctx.prisma.walletAccount.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: { increment: BigInt(amountMinor) } } });
  return wallet.id;
}
const balanceOf = async (accountId: string) => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};
const escrowAccount = () => ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_ESCROW', userId: null, currency: 'BZD' } });
/** Global double-entry invariant: every entry across every account nets to zero. */
const globalLedgerNet = async () => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma); // creates SYSTEM_ESCROW / SYSTEM_TOPUP_CLEARING accounts
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'General' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('successful wallet authorization (customer → escrow)', () => {
  let customer: string[];
  let walletId: string;
  let productId: string;
  let paymentId: string;

  it('moves funds customer → escrow with balanced ledger and AUTHORIZES the payment', async () => {
    customer = await registerCustomer('auth_c1@example.bz');
    walletId = await fundWallet('auth_c1@example.bz', 6000);
    const vendor = await makeVendor('auth_v1@example.bz', 'AuthShop');
    productId = await createProduct(vendor.cookies, { title: 'Authy', sku: 'AUTH', priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    await checkout(customer).expect(201);
    paymentId = (await paymentOf(customer)).id;

    const res = await authorize(customer, paymentId).expect(201);
    expect(res.body.status).toBe('AUTHORIZED');
    expect(res.body.holds[0]).toMatchObject({ status: 'AUTHORIZED' });
    expect(res.body.holds[0].walletTransactionId).toBeTruthy();
    expect(res.body.ledgerReferences[0]).toMatchObject({ status: 'POSTED' });
    expect(res.body.ledgerReferences[0].walletTransactionId).toBeTruthy();

    // Escrow movement: customer 6000-5000=1000, escrow +5000
    const escrow = await escrowAccount();
    expect(await balanceOf(walletId)).toBe(1000n);
    expect(await balanceOf(escrow.id)).toBe(5000n);

    // Ledger balances exactly (topup 2 entries + escrow 2 entries), global net 0
    expect(await globalLedgerNet()).toBe(0n);
    const escrowTx = await ctx.prisma.walletTransaction.findFirstOrThrow({ where: { type: 'ESCROW_HOLD' }, include: { entries: true } });
    const net = escrowTx.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
    expect(escrowTx.entries).toHaveLength(2);
  });

  it('leaves the inventory reservation UNCHANGED (authorization does not touch it)', async () => {
    expect(await reservedFor(productId)).toBe(1);
  });

  it('wrote authorization + escrow audit rows', async () => {
    for (const action of ['PAYMENT_AUTHORIZED', 'ESCROW_FUNDS_HELD', 'WALLET_TRANSACTION_POSTED', 'PAYMENT_STATE_CHANGED'] as const) {
      expect(await ctx.prisma.auditLog.count({ where: { action } })).toBeGreaterThan(0);
    }
  });

  it('is idempotent — re-authorizing replays without double-debiting', async () => {
    const res = await authorize(customer, paymentId).expect(201);
    expect(res.body.status).toBe('AUTHORIZED');
    expect(await balanceOf(walletId)).toBe(1000n); // not debited again
    expect(await ctx.prisma.walletTransaction.count({ where: { reference: `payment:${paymentId}:auth` } })).toBe(1); // one escrow tx only
  });
});

describe('insufficient balance → full rollback', () => {
  it('rejects, cancels the order, releases the reservation, fails the payment, moves no money', async () => {
    const customer = await registerCustomer('auth_poor@example.bz');
    await fundWallet('auth_poor@example.bz', 1000); // only $10
    const vendor = await makeVendor('auth_vpoor@example.bz', 'PoorShop');
    const productId = await createProduct(vendor.cookies, { title: 'Pricey', sku: 'PRICEY', priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const order = (await checkout(customer).expect(201)).body;
    const paymentId = (await paymentOf(customer)).id;
    const escrowBefore = await balanceOf((await escrowAccount()).id);

    const res = await authorize(customer, paymentId);
    expect(res.status).toBe(409);

    const detail = await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', customer).expect(200);
    expect(detail.body.status).toBe('FAILED');
    expect(detail.body.holds[0].status).toBe('RELEASED');
    expect(detail.body.ledgerReferences[0].status).toBe('VOID');
    expect((await request(ctx.server).get(`/api/orders/${order.id}`).set('Cookie', customer)).body.status).toBe('CANCELLED');
    expect(await reservedFor(productId)).toBe(0); // reservation released
    expect(await balanceOf((await escrowAccount()).id)).toBe(escrowBefore); // no escrow movement
    expect(await globalLedgerNet()).toBe(0n);
    for (const action of ['WALLET_VALIDATION_FAILED', 'PAYMENT_AUTHORIZATION_FAILED'] as const) {
      expect(await ctx.prisma.auditLog.count({ where: { action } })).toBeGreaterThan(0);
    }
  });
});

describe('wallet validation failures (each rolls back)', () => {
  async function setup(email: string, business: string, sku: string, fund = 6000) {
    const customer = await registerCustomer(email);
    await fundWallet(email, fund);
    const vendor = await makeVendor(`v_${email}`, business);
    const productId = await createProduct(vendor.cookies, { title: `${business} Item`, sku, priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    await checkout(customer).expect(201);
    return { customer, paymentId: (await paymentOf(customer)).id };
  }

  it('rejects a currency mismatch', async () => {
    const { customer, paymentId } = await setup('auth_cur@example.bz', 'CurShop', 'CUR');
    await ctx.prisma.payment.update({ where: { id: paymentId }, data: { currency: 'USD' } }); // wallet is BZD
    expect((await authorize(customer, paymentId)).status).toBe(409);
    expect((await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', customer)).body.status).toBe('FAILED');
  });

  it('rejects a locked wallet', async () => {
    const { customer, paymentId } = await setup('auth_lock@example.bz', 'LockShop', 'LOCK');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'auth_lock@example.bz' } });
    await ctx.prisma.walletAccount.updateMany({ where: { userId: u.id, type: 'USER' }, data: { status: 'LOCKED' } });
    expect((await authorize(customer, paymentId)).status).toBe(409);
  });

  it('rejects a suspended wallet', async () => {
    const { customer, paymentId } = await setup('auth_susp@example.bz', 'SuspShop', 'SUSP');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'auth_susp@example.bz' } });
    await ctx.prisma.walletAccount.updateMany({ where: { userId: u.id, type: 'USER' }, data: { status: 'SUSPENDED' } });
    expect((await authorize(customer, paymentId)).status).toBe(409);
  });
});

describe('multi-vendor authorization + vendor balances unchanged', () => {
  it('escrows the whole order total; vendor wallets stay at zero', async () => {
    const customer = await registerCustomer('auth_mv@example.bz');
    await fundWallet('auth_mv@example.bz', 10000);
    const a = await makeVendor('auth_mva@example.bz', 'MVA');
    const b = await makeVendor('auth_mvb@example.bz', 'MVB');
    const pa = await createProduct(a.cookies, { title: 'MVA Item', sku: 'MVA1', priceMinor: 2000 });
    const pb = await createProduct(b.cookies, { title: 'MVB Item', sku: 'MVB1', priceMinor: 3000 });
    await setStock(a.cookies, pa, 5); await setStock(b.cookies, pb, 5);
    await addToCart(customer, { productId: pa, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: pb, quantity: 1 }).expect(201);
    await checkout(customer).expect(201);
    const paymentId = (await paymentOf(customer)).id;

    const res = await authorize(customer, paymentId).expect(201);
    expect(res.body.status).toBe('AUTHORIZED');
    expect(res.body.order.vendorOrders).toHaveLength(2);

    const escrow = await escrowAccount();
    expect(await balanceOf(escrow.id)).toBeGreaterThanOrEqual(5000n); // this order's 5000 (+ any prior)
    // vendor wallets untouched (vendors receive nothing)
    for (const email of ['auth_mva@example.bz', 'auth_mvb@example.bz']) {
      const vu = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      const vw = await ctx.prisma.walletAccount.findFirst({ where: { userId: vu.id, type: 'USER' } });
      if (vw) expect(await balanceOf(vw.id)).toBe(0n);
    }
    expect(await globalLedgerNet()).toBe(0n);
  });
});

describe('authorization + escrow release round-trip (returns funds)', () => {
  it('admin release of an AUTHORIZED order returns escrow → customer (net zero)', async () => {
    const customer = await registerCustomer('auth_rt@example.bz');
    const walletId = await fundWallet('auth_rt@example.bz', 5000);
    const vendor = await makeVendor('auth_vrt@example.bz', 'RTShop');
    const productId = await createProduct(vendor.cookies, { title: 'RT', sku: 'RT', priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const order = (await checkout(customer).expect(201)).body;
    const paymentId = (await paymentOf(customer)).id;
    await authorize(customer, paymentId).expect(201);
    expect(await balanceOf(walletId)).toBe(0n); // all escrowed

    await request(ctx.server).post(`/api/admin/orders/${order.id}/release-reservations`).set('Cookie', adminCookies).expect(201);

    const detail = await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', customer).expect(200);
    expect(detail.body.status).toBe('CANCELLED');
    expect(detail.body.holds[0].status).toBe('RELEASED');
    expect(await balanceOf(walletId)).toBe(5000n); // funds returned from escrow
    expect(await globalLedgerNet()).toBe(0n);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'ESCROW_FUNDS_RELEASED' } })).toBeGreaterThan(0);
  });
});

describe('authorization authz + admin wallet reads', () => {
  it('requires authentication + ownership; admin wallet views require wallet.read', async () => {
    const owner = await registerCustomer('auth_own@example.bz');
    await fundWallet('auth_own@example.bz', 6000);
    const vendor = await makeVendor('auth_vown@example.bz', 'OwnShop');
    const productId = await createProduct(vendor.cookies, { title: 'OwnP', sku: 'OWNP', priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(owner, { productId, quantity: 1 }).expect(201);
    await checkout(owner).expect(201);
    const paymentId = (await paymentOf(owner)).id;
    const other = await registerCustomer('auth_other@example.bz');

    await request(ctx.server).post(`/api/payments/${paymentId}/authorize`).expect(401); // anon
    await authorize(other, paymentId).expect(404); // not owner
    await authorize(owner, paymentId).expect(201); // owner

    // admin wallet reads (super-admin has wallet.read)
    const accounts = await request(ctx.server).get('/api/admin/wallet/accounts').set('Cookie', adminCookies).expect(200);
    expect(accounts.body.some((a: { type: string }) => a.type === 'SYSTEM_ESCROW')).toBe(true);
    const txns = await request(ctx.server).get('/api/admin/wallet/transactions').set('Cookie', adminCookies).expect(200);
    expect(txns.body.every((t: { balanced: boolean }) => t.balanced)).toBe(true); // every tx balances
    await request(ctx.server).get('/api/admin/wallet/accounts').set('Cookie', owner).expect(403); // customer denied
  });
});
