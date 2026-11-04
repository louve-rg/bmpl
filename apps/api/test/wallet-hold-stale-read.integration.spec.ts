/**
 * Admin stale-wallet-hold READ (GET /api/admin/payments/stale-holds) — integration
 * vs real Postgres. This is a READ ONLY preview: it must never release, expire,
 * capture or otherwise modify a hold. Coverage: a stale hold is returned, a
 * too-recent hold is not, a released hold is not, the server-computed total is
 * never corrupted by the page size, and an unauthorized caller is refused.
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
  await request(ctx.server).patch('/api/vendor/profile').set('Cookie', cookies).send({ storeStatus: 'OPEN' }).expect(200);
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
const checkout = (cookies: string[]) => request(ctx.server).post('/api/checkout').set('Cookie', cookies).send({});

/** One customer, one vendor, one product, one checkout — one fresh HELD hold. */
async function holdFixture(tag: string) {
  const customer = await registerCustomer(`stale_c_${tag}@example.bz`);
  const vendor = await makeVendor(`stale_v_${tag}@example.bz`, `StaleShop${tag}`);
  const productId = await createProduct(vendor.cookies, { title: `Stale ${tag}`, sku: `STALE${tag}`, priceMinor: 1500 });
  await setStock(vendor.cookies, productId, 5);
  await addToCart(customer, { productId, quantity: 1 }).expect(201);
  const order = (await checkout(customer).expect(201)).body;
  const paymentRes = await request(ctx.server).get('/api/payments').set('Cookie', customer).expect(200);
  const paymentId = paymentRes.body[0].id as string;
  const hold = await ctx.prisma.walletHold.findFirstOrThrow({ where: { paymentId } });
  return { customer, orderId: order.id as string, paymentId, holdId: hold.id };
}

const ageHold = (holdId: string, hours: number) =>
  ctx.prisma.walletHold.update({ where: { id: holdId }, data: { heldAt: new Date(Date.now() - hours * 60 * 60 * 1000) } });

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

describe('GET /admin/payments/stale-holds', () => {
  it('returns a hold whose heldAt is older than the threshold, and does not touch it', async () => {
    const f = await holdFixture('old');
    await ageHold(f.holdId, 48);

    const res = await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24').set('Cookie', adminCookies).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const row = res.body.holds.find((h: { id: string }) => h.id === f.holdId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ status: 'HELD', amountMinor: 1500, currency: 'BZD', walletAccountId: expect.any(String) });
    expect(row.customer).toContain('C');
    expect(row.payment).toMatchObject({ id: f.paymentId, status: 'PENDING', resourceType: 'ORDER' });
    expect(new Date(row.heldAt).getTime()).toBeLessThan(Date.now() - 24 * 60 * 60 * 1000);

    // A read must never touch the row it reports on.
    const after = await ctx.prisma.walletHold.findUniqueOrThrow({ where: { id: f.holdId } });
    expect(after.status).toBe('HELD');
    expect(after.releasedAt).toBeNull();
  });

  it('excludes a hold that is too recent', async () => {
    const f = await holdFixture('fresh');
    // heldAt is "now" (never aged) — well inside the 24h window.
    const res = await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24').set('Cookie', adminCookies).expect(200);
    const row = res.body.holds.find((h: { id: string }) => h.id === f.holdId);
    expect(row).toBeUndefined();
  });

  it('excludes a hold that has already been released', async () => {
    const f = await holdFixture('released');
    await ageHold(f.holdId, 48);
    // Release it through the real admin action, not a direct write — proves the
    // read is filtering by current status, not just age.
    await request(ctx.server).post(`/api/admin/orders/${f.orderId}/release-reservations`).set('Cookie', adminCookies).expect(201);
    const releasedHold = await ctx.prisma.walletHold.findUniqueOrThrow({ where: { id: f.holdId } });
    expect(releasedHold.status).toBe('RELEASED');

    const res = await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24').set('Cookie', adminCookies).expect(200);
    const row = res.body.holds.find((h: { id: string }) => h.id === f.holdId);
    expect(row).toBeUndefined();
  });

  it('reports a true total unaffected by page size, and pages through every row', async () => {
    // Sequential, not Promise.all: each fixture drives a full register → vendor
    // → checkout flow through the same test server, and firing three of those
    // concurrently is a load pattern this suite doesn't otherwise exercise.
    const fixtures = [];
    for (const t of ['p1', 'p2', 'p3']) {
      const f = await holdFixture(`page_${t}`);
      await ageHold(f.holdId, 72);
      fixtures.push(f);
    }
    const ids = fixtures.map((f) => f.holdId);

    const full = await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24&pageSize=100').set('Cookie', adminCookies).expect(200);
    const fullTotal = full.body.total;
    expect(fullTotal).toBeGreaterThanOrEqual(ids.length);
    for (const id of ids) expect(full.body.holds.map((h: { id: string }) => h.id)).toContain(id);

    // A page size of 1 must report the SAME total as the unconstrained read —
    // the count is never derived from the rows that happened to come back.
    const page1 = await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24&pageSize=1&page=1').set('Cookie', adminCookies).expect(200);
    expect(page1.body.total).toBe(fullTotal);
    expect(page1.body.holds).toHaveLength(1);

    // Walking every page (bounded by the known total) recovers every fixture id
    // exactly once — pagination does not drop or duplicate rows.
    const seen = new Set<string>();
    for (let page = 1; page <= fullTotal; page++) {
      const res = await request(ctx.server).get(`/api/admin/payments/stale-holds?olderThanHours=24&pageSize=1&page=${page}`).set('Cookie', adminCookies).expect(200);
      expect(res.body.total).toBe(fullTotal);
      expect(res.body.holds).toHaveLength(1);
      seen.add(res.body.holds[0].id);
    }
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it('is a pure read: no audit row, no hold mutation, no wallet ledger entry', async () => {
    const f = await holdFixture('readonly');
    await ageHold(f.holdId, 48);
    const auditBefore = await ctx.prisma.auditLog.count();
    const ledgerBefore = await ctx.prisma.walletLedgerEntry.count();

    await request(ctx.server).get('/api/admin/payments/stale-holds?olderThanHours=24').set('Cookie', adminCookies).expect(200);

    expect(await ctx.prisma.auditLog.count()).toBe(auditBefore);
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(ledgerBefore);
    const hold = await ctx.prisma.walletHold.findUniqueOrThrow({ where: { id: f.holdId } });
    expect(hold.status).toBe('HELD');
  });

  it('requires authentication, then payments.read — not any admin session', async () => {
    await request(ctx.server).get('/api/admin/payments/stale-holds').expect(401);

    const customer = await registerCustomer('stale_customer_noperm@example.bz');
    await request(ctx.server).get('/api/admin/payments/stale-holds').set('Cookie', customer).expect(403);

    const noPerm = await seedLimitedAdmin(ctx.prisma, 'stale_admin_noperm@example.bz', ['orders.read']);
    const npCookies = await login(noPerm.email, noPerm.password);
    await request(ctx.server).get('/api/admin/payments/stale-holds').set('Cookie', npCookies).expect(403);

    const ro = await seedLimitedAdmin(ctx.prisma, 'stale_admin_ro@example.bz', ['payments.read']);
    const roCookies = await login(ro.email, ro.password);
    await request(ctx.server).get('/api/admin/payments/stale-holds').set('Cookie', roCookies).expect(200);

    await request(ctx.server).get('/api/admin/payments/stale-holds').set('Cookie', adminCookies).expect(200);
  });
});
