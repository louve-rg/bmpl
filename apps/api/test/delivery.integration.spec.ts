/**
 * Delivery & Shipping Foundation (Phase 4 · M13) — integration vs real Postgres.
 * Vendor delivery config (settings, zones+fees, estimate), the pricing engine
 * (flat / zone / free-threshold / minimum), pickup vs delivery checkout, order
 * delivery snapshot (fee, estimate, instructions, PENDING_ASSIGNMENT, address),
 * the pre-checkout quote, and authorization.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

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
  const vpId = profile.body.profile.id as string;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId };
}
async function createProduct(cookies: string[], title: string, priceMinor: number) {
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ title, sku: `${title}-1`, categoryId, priceMinor });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const restock = (cookies: string[], productId: string, delta: number) =>
  request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', cookies).send({ delta, reason: 'RESTOCK' }).expect(201);
const publishDirect = (productId: string) =>
  ctx.prisma.product.update({ where: { id: productId }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
const addItem = (cookies: string[], productId: string, quantity = 1) =>
  request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send({ productId, quantity });
const clearCart = (cookies: string[]) => request(ctx.server).delete('/api/cart').set('Cookie', cookies);

const ADDR = { fullName: 'Jane Buyer', phone: '+5016000000', addressLine1: '1 Front St', city: 'Belize City', district: 'BELIZE' };

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

describe('vendor delivery configuration', () => {
  let vendor: Awaited<ReturnType<typeof makeVendor>>;

  it('rejects config from a non-vendor (403) and unauthenticated (401)', async () => {
    const customer = await registerCustomer('deliv_cust@example.bz');
    await request(ctx.server).get('/api/vendor/delivery').set('Cookie', customer).expect(403);
    await request(ctx.server).get('/api/vendor/delivery').expect(401);
  });

  it('configures settings, a zone with a fee, and an estimate', async () => {
    vendor = await makeVendor('deliv_v1@example.bz', 'Deliv One');
    const settings = await request(ctx.server)
      .patch('/api/vendor/settings')
      .set('Cookie', vendor.cookies)
      .send({ deliveryEnabled: true, baseDeliveryFeeMinor: 800, freeDeliveryThresholdMinor: 10000, minimumOrderMinor: 500 });
    expect(settings.status).toBe(200);

    const zone = await request(ctx.server)
      .post('/api/vendor/delivery/zones')
      .set('Cookie', vendor.cookies)
      .send({ name: 'City', districts: ['BELIZE'], feeMinor: 500 });
    expect(zone.status).toBe(201);
    expect(zone.body.zones).toHaveLength(1);
    expect(zone.body.zones[0]).toMatchObject({ name: 'City', feeMinor: 500, districts: ['BELIZE'] });

    const est = await request(ctx.server).put('/api/vendor/delivery/estimate').set('Cookie', vendor.cookies).send({ minHours: 24, maxHours: 72, label: '1–3 days' });
    expect(est.status).toBe(200);
    expect(est.body.estimate).toMatchObject({ minHours: 24, maxHours: 72 });
  });

  it('rejects a second zone overlapping the same district', async () => {
    await request(ctx.server)
      .post('/api/vendor/delivery/zones')
      .set('Cookie', vendor.cookies)
      .send({ name: 'City 2', districts: ['BELIZE'], feeMinor: 700 })
      .expect(400);
  });
});

describe('delivery pricing at checkout', () => {
  let vendor: Awaited<ReturnType<typeof makeVendor>>;
  let productId: string;

  beforeAll(async () => {
    vendor = await makeVendor('deliv_v2@example.bz', 'Deliv Two');
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 800, freeDeliveryThresholdMinor: 10000 });
    await request(ctx.server).post('/api/vendor/delivery/zones').set('Cookie', vendor.cookies).send({ name: 'City', districts: ['BELIZE'], feeMinor: 500 });
    await request(ctx.server).put('/api/vendor/delivery/estimate').set('Cookie', vendor.cookies).send({ minHours: 24, maxHours: 72, label: '1–3 days' });
    productId = await createProduct(vendor.cookies, 'Widget', 2000);
    await restock(vendor.cookies, productId, 100);
    await publishDirect(productId);
  });

  async function checkout(cookies: string[], body: Record<string, unknown>) {
    return request(ctx.server).post('/api/checkout').set('Cookie', cookies).send(body);
  }

  it('PICKUP order stores no delivery fee and no delivery record', async () => {
    const c = await registerCustomer('deliv_c_pickup@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await checkout(c, { vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'PICKUP' }] });
    expect(res.status).toBe(201);
    expect(res.body.deliveryFeeMinor).toBe(0);
    expect(res.body.totalMinor).toBe(2000);
    expect(res.body.vendorOrders[0].deliveryMethod).toBe('PICKUP');
    expect(res.body.vendorOrders[0].delivery).toBeNull();
    expect(res.body.deliveryAddress).toBeNull();
  });

  it('DELIVERY order to a zoned district applies the zone fee + snapshots delivery', async () => {
    const c = await registerCustomer('deliv_c_zone@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await checkout(c, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY', deliveryInstructions: 'Leave at gate' }],
      deliveryAddress: ADDR,
    });
    expect(res.status).toBe(201);
    expect(res.body.deliveryFeeMinor).toBe(500); // zone fee
    expect(res.body.totalMinor).toBe(2500); // 2000 + 500
    const vo = res.body.vendorOrders[0];
    expect(vo.deliveryMethod).toBe('DELIVERY');
    expect(vo.delivery).toMatchObject({ status: 'PENDING_ASSIGNMENT', feeMinor: 500, freeApplied: false, instructions: 'Leave at gate' });
    expect(vo.delivery.estimate).toMatchObject({ minHours: 24, maxHours: 72 });
    expect(res.body.deliveryAddress).toMatchObject({ fullName: 'Jane Buyer', district: 'BELIZE' });
  });

  it('DELIVERY to a non-zoned district falls back to the base flat fee', async () => {
    const c = await registerCustomer('deliv_c_base@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await checkout(c, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: { ...ADDR, district: 'CAYO', city: 'San Ignacio' },
    });
    expect(res.status).toBe(201);
    expect(res.body.deliveryFeeMinor).toBe(800); // base flat fee
    expect(res.body.totalMinor).toBe(2800);
  });

  it('free-delivery threshold makes delivery free', async () => {
    const c = await registerCustomer('deliv_c_free@example.bz');
    await addItem(c, productId, 6).expect(201); // 6 * 2000 = 12000 >= 10000 threshold
    const res = await checkout(c, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: ADDR,
    });
    expect(res.status).toBe(201);
    expect(res.body.deliveryFeeMinor).toBe(0);
    expect(res.body.totalMinor).toBe(12000);
    expect(res.body.vendorOrders[0].delivery.freeApplied).toBe(true);
  });

  it('DELIVERY requires an address (400)', async () => {
    const c = await registerCustomer('deliv_c_noaddr@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await checkout(c, { vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }] });
    expect(res.status).toBe(400);
    await clearCart(c);
  });

  it('the pre-checkout quote returns per-vendor fee + totals', async () => {
    const c = await registerCustomer('deliv_c_quote@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await request(ctx.server)
      .post('/api/checkout/delivery-quote')
      .set('Cookie', c)
      .send({ district: 'BELIZE', vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }] });
    expect(res.status).toBe(201);
    expect(res.body.deliveryFeeMinor).toBe(500);
    expect(res.body.totalMinor).toBe(2500);
    expect(res.body.vendors[0]).toMatchObject({ deliverable: true, feeMinor: 500 });
    await clearCart(c);
  });
});

describe('delivery not offered', () => {
  it('rejects DELIVERY when the vendor has delivery disabled', async () => {
    const vendor = await makeVendor('deliv_v3@example.bz', 'Pickup Only');
    // deliveryEnabled defaults to false
    const productId = await createProduct(vendor.cookies, 'PickupWidget', 1500);
    await restock(vendor.cookies, productId, 10);
    await publishDirect(productId);

    const c = await registerCustomer('deliv_c_nodeliv@example.bz');
    await addItem(c, productId, 1).expect(201);
    const res = await request(ctx.server)
      .post('/api/checkout')
      .set('Cookie', c)
      .send({ vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }], deliveryAddress: ADDR });
    expect(res.status).toBe(400);
  });
});
