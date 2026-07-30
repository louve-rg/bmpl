/**
 * Payments & wallet holds (Phase 3 · M11 — foundation) — integration vs real Postgres.
 * Checkout creates a Payment (CREATED→PENDING) + soft WalletHold (HELD) + a PENDING
 * LedgerReference, idempotently. NO money moves: no wallet ledger entries, no balance
 * change. Release cancels the payment + releases the hold. Plus authz/ownership/audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;

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
  const vpId = profile.body.profile.id;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId };
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
function checkout(cookies: string[], body: Record<string, unknown> = {}, idempotencyKey?: string) {
  const req = request(ctx.server).post('/api/checkout').set('Cookie', cookies);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'General' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('payment + wallet hold created at checkout (no money moved)', () => {
  let customer: string[];
  let paymentId: string;

  it('creates a PENDING payment, a HELD wallet hold, and a PENDING ledger reference', async () => {
    customer = await registerCustomer('pay_c1@example.bz');
    const vendor = await makeVendor('pay_v1@example.bz', 'PayShop');
    const productId = await createProduct(vendor.cookies, { title: 'Payable', sku: 'PAY', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    await checkout(customer).expect(201);

    const list = await request(ctx.server).get('/api/payments').set('Cookie', customer).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ status: 'PENDING', methodType: 'WALLET', amountMinor: 2000, holdStatus: 'HELD' });
    paymentId = list.body[0].id;

    const detail = await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', customer).expect(200);
    expect(detail.body.status).toBe('PENDING');
    expect(detail.body.holds[0]).toMatchObject({ status: 'HELD', amountMinor: 2000 });
    expect(detail.body.ledgerReferences[0]).toMatchObject({ purpose: 'CUSTOMER_PAYMENT', direction: 'DEBIT', status: 'PENDING' });
    const eventTypes = detail.body.events.map((e: { type: string }) => e.type);
    expect(eventTypes).toEqual(expect.arrayContaining(['CREATED', 'HOLD_CREATED', 'STATE_CHANGED']));
    // status endpoint
    const st = await request(ctx.server).get(`/api/payments/${paymentId}/status`).set('Cookie', customer).expect(200);
    expect(st.body.status).toBe('PENDING');
  });

  it('moved NO money — no wallet ledger entries, wallet balance unchanged', async () => {
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(0);
    expect(await ctx.prisma.walletTransaction.count()).toBe(0);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { user: { email: 'pay_c1@example.bz' }, type: 'USER' } });
    expect(wallet.cachedBalanceMinor).toBe(0n);
  });

  it('wrote payment + hold + state-change audit rows', async () => {
    for (const action of ['PAYMENT_CREATED', 'WALLET_HOLD_CREATED', 'PAYMENT_STATE_CHANGED'] as const) {
      expect(await ctx.prisma.auditLog.count({ where: { action } })).toBeGreaterThan(0);
    }
  });
});

describe('multi-vendor order relationship', () => {
  it('one payment references the whole order and its vendor-order split', async () => {
    const customer = await registerCustomer('pay_c2@example.bz');
    const a = await makeVendor('pay_v2a@example.bz', 'Alpha');
    const b = await makeVendor('pay_v2b@example.bz', 'Beta');
    const pa = await createProduct(a.cookies, { title: 'A Item', sku: 'A1', priceMinor: 1000 });
    const pb = await createProduct(b.cookies, { title: 'B Item', sku: 'B1', priceMinor: 2000 });
    await setStock(b.cookies, pb, 5);
    await addToCart(customer, { productId: pa, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: pb, quantity: 1 }).expect(201);
    await checkout(customer).expect(201);

    const list = await request(ctx.server).get('/api/payments').set('Cookie', customer).expect(200);
    expect(list.body).toHaveLength(1);
    const detail = await request(ctx.server).get(`/api/payments/${list.body[0].id}`).set('Cookie', customer).expect(200);
    expect(detail.body.amountMinor).toBe(3000);
    expect(detail.body.order.vendorOrders).toHaveLength(2);
  });
});

describe('idempotent checkout — duplicate requests never create duplicate payments', () => {
  it('replays the original order/payment for the same Idempotency-Key', async () => {
    const customer = await registerCustomer('pay_idem@example.bz');
    const vendor = await makeVendor('pay_videm@example.bz', 'IdemShop');
    const productId = await createProduct(vendor.cookies, { title: 'Idem', sku: 'IDEM', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);

    const first = await checkout(customer, {}, 'key-abc').expect(201);
    const orderId = first.body.id;
    // Cart is now empty; a second call with the SAME key replays (does not 400 or duplicate).
    const second = await checkout(customer, {}, 'key-abc').expect(201);
    expect(second.body.id).toBe(orderId);

    const userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'pay_idem@example.bz' } })).id;
    expect(await ctx.prisma.payment.count({ where: { userId } })).toBe(1); // exactly one payment
    expect(await ctx.prisma.order.count({ where: { userId } })).toBe(1); // exactly one order
    expect(await ctx.prisma.auditLog.count({ where: { action: 'IDEMPOTENCY_KEY_REPLAYED' } })).toBeGreaterThan(0);
  });
});

describe('wallet hold release + payment cancel (via order reservation release)', () => {
  it('releases the HELD hold and cancels the payment', async () => {
    const customer = await registerCustomer('pay_rel@example.bz');
    const vendor = await makeVendor('pay_vrel@example.bz', 'RelPayShop');
    const productId = await createProduct(vendor.cookies, { title: 'RelPay', sku: 'RELP', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const order = (await checkout(customer).expect(201)).body;
    const paymentId = (await request(ctx.server).get('/api/payments').set('Cookie', customer)).body[0].id;

    await request(ctx.server).post(`/api/admin/orders/${order.id}/release-reservations`).set('Cookie', adminCookies).expect(201);

    const detail = await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', customer).expect(200);
    expect(detail.body.status).toBe('CANCELLED');
    expect(detail.body.holds[0].status).toBe('RELEASED');
    expect(detail.body.ledgerReferences[0].status).toBe('VOID');
    const eventTypes = detail.body.events.map((e: { type: string }) => e.type);
    expect(eventTypes).toContain('HOLD_RELEASED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'WALLET_HOLD_RELEASED' } })).toBeGreaterThan(0);
    // still no money moved
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(0);
  });
});

describe('authorization + ownership', () => {
  let owner: string[];
  let other: string[];
  let paymentId: string;

  beforeAll(async () => {
    owner = await registerCustomer('pay_own@example.bz');
    other = await registerCustomer('pay_other@example.bz');
    const vendor = await makeVendor('pay_vown@example.bz', 'OwnShop');
    const productId = await createProduct(vendor.cookies, { title: 'Own', sku: 'OWN', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(owner, { productId, quantity: 1 }).expect(201);
    await checkout(owner).expect(201);
    paymentId = (await request(ctx.server).get('/api/payments').set('Cookie', owner)).body[0].id;
  });

  it('keeps payments private to their owner', async () => {
    await request(ctx.server).get(`/api/payments/${paymentId}`).set('Cookie', other).expect(404);
    expect((await request(ctx.server).get('/api/payments').set('Cookie', other).expect(200)).body).toEqual([]);
  });

  it('requires authentication', async () => {
    await request(ctx.server).get('/api/payments').expect(401);
    await request(ctx.server).get('/api/admin/payments').expect(401);
  });

  it('gates admin payment views on payments.read', async () => {
    await request(ctx.server).get('/api/admin/payments').set('Cookie', owner).expect(403); // customer
    await request(ctx.server).get('/api/admin/payments').set('Cookie', adminCookies).expect(200); // super-admin
    const ro = await seedLimitedAdmin(ctx.prisma, 'pay_ro@example.bz', ['payments.read']);
    const roCookies = await login(ro.email, ro.password);
    const res = await request(ctx.server).get('/api/admin/payments').set('Cookie', roCookies).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const detail = await request(ctx.server).get(`/api/admin/payments/${paymentId}`).set('Cookie', roCookies).expect(200);
    expect(detail.body.customer.email).toBe('pay_own@example.bz');
    // a limited admin WITHOUT payments.read cannot read payments
    const noPerm = await seedLimitedAdmin(ctx.prisma, 'pay_noperm@example.bz', ['orders.read']);
    const npCookies = await login(noPerm.email, noPerm.password);
    await request(ctx.server).get('/api/admin/payments').set('Cookie', npCookies).expect(403);
  });
});
