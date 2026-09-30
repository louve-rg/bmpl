/**
 * Owner ruling (BMPL-351): a customer's ONE checkout from ONE vendor is ONE
 * coherent purchase — charged exactly one delivery fee and judged against
 * one free-delivery threshold, whatever BML internally split fulfilment
 * into. The internal split (BMPL-175: multiple VendorOrder/OrderDelivery
 * rows across multiple origin locations when stock requires it) stays; only
 * the CUSTOMER-FACING charge and the free-delivery qualification move to
 * the vendor/cart level.
 *
 * The ledger-safety half of this card, not just the customer-facing half:
 * OrderDelivery.feeMinor is also what settlement.service.ts pays a driver a
 * percentage of. This file proves sum(OrderDelivery.feeMinor across a
 * vendor's split origins) always equals the ONE fee actually charged —
 * never more, which is what keeps settlement from paying out money that was
 * never collected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

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
async function addLocation(cookies: string[], label: string, isPrimary = false) {
  const res = await request(ctx.server)
    .post('/api/vendor/profile/locations')
    .set('Cookie', cookies)
    .send({ label, addressLine1: `1 ${label} St`, city: 'Belize City', district: 'BELIZE', isPrimary });
  expect(res.status).toBe(201);
  return res.body.locations.find((l: { label: string }) => l.label === label).id as string;
}
const adjustAt = (cookies: string[], productId: string, locationId: string, delta: number) =>
  request(ctx.server)
    .post(`/api/vendor/products/${productId}/inventory/locations/${locationId}/adjust`)
    .set('Cookie', cookies)
    .send({ delta, reason: 'RESTOCK' });
const addToCart = (cookies: string[], body: Record<string, unknown>) => request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body);
const checkout = (cookies: string[], body: Record<string, unknown> = {}) => request(ctx.server).post('/api/checkout').set('Cookie', cookies).send(body);
const deliveryAddress = { fullName: 'C U', addressLine1: '1 Main St', city: 'Belize City', district: 'BELIZE' };

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `Cat ${uniq()}` });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('a split-origin fulfilment charges the customer ONE delivery fee (BMPL-351)', () => {
  it('two products at two locations of the SAME vendor: one fee charged, not two — and the two resulting deliveries sum back to it exactly', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v351_${s}@example.bz`, `V351 ${s}`);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 500 });
    const locA = await addLocation(vendor.cookies, 'Shop A', true);
    const locB = await addLocation(vendor.cookies, 'Shop B', false);
    const productA = await createProduct(vendor.cookies, { title: `Product A ${s}`, sku: `PA-${s}`, priceMinor: 1500 });
    const productB = await createProduct(vendor.cookies, { title: `Product B ${s}`, sku: `PB-${s}`, priceMinor: 1500 });
    // A is ONLY at location A, B is ONLY at location B — checkout has no
    // choice but to split this vendor's fulfilment into two VendorOrders.
    await adjustAt(vendor.cookies, productA, locA, 5).expect(201);
    await adjustAt(vendor.cookies, productB, locB, 5).expect(201);

    const customer = await registerCustomer(`c351_${s}@example.bz`);
    await addToCart(customer, { productId: productA, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productB, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress,
    }).expect(201);

    // Two VendorOrders — the internal split still happened, unchanged.
    expect(res.body.vendorOrders).toHaveLength(2);
    // But the ORDER was charged the vendor's base fee exactly ONCE, not
    // once per split leg (500, not 1000).
    expect(res.body.deliveryFeeMinor).toBe(500);

    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(order.deliveryFeeMinor).toBe(500n);

    const deliveries = await ctx.prisma.orderDelivery.findMany({ where: { vendorOrder: { orderId: res.body.id } } });
    expect(deliveries).toHaveLength(2);
    // THE LEDGER-SAFETY ASSERTION: the two split deliveries' own fees sum
    // back to EXACTLY the one fee charged — never more. This is what
    // settlement.service.ts later pays drivers a percentage of; if this
    // summed to more than 500, settlement would pay out money that was
    // never collected from the customer.
    const sum = deliveries.reduce((s2, d) => s2 + d.feeMinor, 0n);
    expect(sum).toBe(500n);
    // Both groups deliver to the SAME address, so their standalone quotes
    // are the SAME flat base rate regardless of subtotal (see the next
    // test for a case that actually distinguishes rate-based allocation
    // from subtotal-based) — this assertion alone doesn't prove WHICH
    // basis was used, only that the split is even here.
    expect(deliveries.map((d) => d.feeMinor).sort()).toEqual([250n, 250n]);
  });

  it('allocates by each origin\'s own standalone delivery RATE, not by how much of the cart\'s value it shipped — a $90/$10 split still splits the fee evenly', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v351rate_${s}@example.bz`, `V351Rate ${s}`);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 500 });
    const locA = await addLocation(vendor.cookies, 'Shop A', true);
    const locB = await addLocation(vendor.cookies, 'Shop B', false);
    // Deliberately LOPSIDED subtotals — $90 at A, $10 at B. If allocation
    // were still by subtotal share, A would get ~450 and B ~50. Since both
    // origins deliver to the SAME address at the SAME flat base rate, the
    // correct allocation is the standalone quote for each — identical for
    // both — so the fee should split evenly regardless of the $90/$10 gap.
    const productA = await createProduct(vendor.cookies, { title: `Rate A ${s}`, sku: `RA-${s}`, priceMinor: 9000 });
    const productB = await createProduct(vendor.cookies, { title: `Rate B ${s}`, sku: `RB-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productA, locA, 5).expect(201);
    await adjustAt(vendor.cookies, productB, locB, 5).expect(201);

    const customer = await registerCustomer(`c351rate_${s}@example.bz`);
    await addToCart(customer, { productId: productA, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productB, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress,
    }).expect(201);

    expect(res.body.deliveryFeeMinor).toBe(500); // still charged once, pooled
    const deliveries = await ctx.prisma.orderDelivery.findMany({ where: { vendorOrder: { orderId: res.body.id } } });
    expect(deliveries.reduce((s2, d) => s2 + d.feeMinor, 0n)).toBe(500n);
    // NOT proportional to $90/$10 (which would be ~450/~50) — even, because
    // the standalone RATE is identical for both origins.
    expect(deliveries.map((d) => d.feeMinor).sort()).toEqual([250n, 250n]);
  });

  it('a fee that does NOT divide evenly still sums EXACTLY — largest-remainder, not a naive per-leg round()', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v351odd_${s}@example.bz`, `V351Odd ${s}`);
    // 501 split three ways by an EQUAL-weight rate is the case a naive
    // "round each share, last one mops up" implementation gets wrong in
    // the opposite way this test would catch: floor(501/3)=167 three
    // times sums to 501 exactly ONLY if the leftover is actually
    // distributed — 167*3=501 here by coincidence of divisibility, so use
    // a genuinely non-divisible fee instead: 500 split three ways.
    // floor(500/3)=166 three times = 498, leftover 2 — a naive
    // "last leg gets everything left over" implementation would still sum
    // correctly (498+2=500) but hand BOTH extra cents to one arbitrary
    // leg; largest-remainder spreads them across the two legs with the
    // largest fractional remainder instead. Either way this test asserts
    // the one invariant that actually matters for the ledger: exact sum.
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 500 });
    const locA = await addLocation(vendor.cookies, 'Shop A', true);
    const locB = await addLocation(vendor.cookies, 'Shop B', false);
    const locC = await addLocation(vendor.cookies, 'Shop C', false);
    const productA = await createProduct(vendor.cookies, { title: `Odd A ${s}`, sku: `OA-${s}`, priceMinor: 1000 });
    const productB = await createProduct(vendor.cookies, { title: `Odd B ${s}`, sku: `OB-${s}`, priceMinor: 1000 });
    const productC = await createProduct(vendor.cookies, { title: `Odd C ${s}`, sku: `OC-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productA, locA, 5).expect(201);
    await adjustAt(vendor.cookies, productB, locB, 5).expect(201);
    await adjustAt(vendor.cookies, productC, locC, 5).expect(201);

    const customer = await registerCustomer(`c351odd_${s}@example.bz`);
    await addToCart(customer, { productId: productA, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productB, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productC, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress,
    }).expect(201);

    expect(res.body.vendorOrders).toHaveLength(3);
    expect(res.body.deliveryFeeMinor).toBe(500);
    const deliveries = await ctx.prisma.orderDelivery.findMany({ where: { vendorOrder: { orderId: res.body.id } } });
    expect(deliveries).toHaveLength(3);
    const sum = deliveries.reduce((s2, d) => s2 + d.feeMinor, 0n);
    expect(sum).toBe(500n); // the one assertion a naive implementation can still fail
    // Largest-remainder, equal weights: two legs get 167, one gets 166
    // (166*3=498, +2 leftover to the two legs — every weight is tied, so
    // which two is a stable tie-break, not asserted here).
    const sorted = deliveries.map((d) => d.feeMinor).sort((a, b) => Number(a - b));
    expect(sorted).toEqual([166n, 167n, 167n]);
  });

  it('the free-delivery threshold is judged on the POOLED vendor subtotal, not any one split origin\'s own share', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v351free_${s}@example.bz`, `V351Free ${s}`);
    await request(ctx.server)
      .patch('/api/vendor/settings')
      .set('Cookie', vendor.cookies)
      .send({ deliveryEnabled: true, baseDeliveryFeeMinor: 500, freeDeliveryThresholdMinor: 2000 });
    const locA = await addLocation(vendor.cookies, 'Shop A', true);
    const locB = await addLocation(vendor.cookies, 'Shop B', false);
    // $15 + $10 = $25 pooled, clears the $20 threshold — but NEITHER
    // individual location's own share ($15, $10) would clear it alone.
    const productA = await createProduct(vendor.cookies, { title: `Free A ${s}`, sku: `FA-${s}`, priceMinor: 1500 });
    const productB = await createProduct(vendor.cookies, { title: `Free B ${s}`, sku: `FB-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productA, locA, 5).expect(201);
    await adjustAt(vendor.cookies, productB, locB, 5).expect(201);

    const customer = await registerCustomer(`c351free_${s}@example.bz`);
    await addToCart(customer, { productId: productA, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productB, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress,
    }).expect(201);

    expect(res.body.vendorOrders).toHaveLength(2);
    expect(res.body.deliveryFeeMinor).toBe(0); // free — pooled subtotal cleared the threshold

    const deliveries = await ctx.prisma.orderDelivery.findMany({ where: { vendorOrder: { orderId: res.body.id } } });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.feeMinor === 0n)).toBe(true);
    expect(deliveries.every((d) => d.freeApplied === true)).toBe(true);
  });

  it('a one-location vendor (the overwhelming majority) sees no change at all — single VendorOrder, single fee, as before', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v351single_${s}@example.bz`, `V351Single ${s}`);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 700 });
    const productId = await createProduct(vendor.cookies, { title: `Solo ${s}`, sku: `SO-${s}`, priceMinor: 1000 });
    await request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);

    const customer = await registerCustomer(`c351single_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [{ vendorProfileId: vendor.vpId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress,
    }).expect(201);

    expect(res.body.vendorOrders).toHaveLength(1);
    expect(res.body.deliveryFeeMinor).toBe(700);
    const delivery = await ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId: res.body.id } } });
    expect(delivery.feeMinor).toBe(700n);
  });

  it('two DIFFERENT vendors in one cart are still priced independently — pooling is per-vendor, never across vendors', async () => {
    const s = uniq();
    const vendorA = await makeVendor(`v351mixa_${s}@example.bz`, `MixA ${s}`);
    const vendorB = await makeVendor(`v351mixb_${s}@example.bz`, `MixB ${s}`);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendorA.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 300 });
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendorB.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 900 });
    const productA = await createProduct(vendorA.cookies, { title: `MixA Item ${s}`, sku: `MA-${s}`, priceMinor: 1000 });
    const productB = await createProduct(vendorB.cookies, { title: `MixB Item ${s}`, sku: `MB-${s}`, priceMinor: 1000 });
    await request(ctx.server).post(`/api/vendor/products/${productA}/inventory/adjust`).set('Cookie', vendorA.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);
    await request(ctx.server).post(`/api/vendor/products/${productB}/inventory/adjust`).set('Cookie', vendorB.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);

    const customer = await registerCustomer(`c351mix_${s}@example.bz`);
    await addToCart(customer, { productId: productA, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: productB, quantity: 1 }).expect(201);
    const res = await checkout(customer, {
      vendors: [
        { vendorProfileId: vendorA.vpId, deliveryMethod: 'DELIVERY' },
        { vendorProfileId: vendorB.vpId, deliveryMethod: 'DELIVERY' },
      ],
      deliveryAddress,
    }).expect(201);

    expect(res.body.vendorOrders).toHaveLength(2);
    expect(res.body.deliveryFeeMinor).toBe(1200); // 300 + 900, each vendor its own fee
  });
});
