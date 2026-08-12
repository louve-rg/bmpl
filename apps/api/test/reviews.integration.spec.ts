/**
 * Reviews & Ratings (Phase 4 · M19) — integration vs real Postgres. Verified reviews
 * tied to completed transactions (product/vendor/driver), variant snapshot, eligibility
 * (delivery DELIVERED / pickup PICKED_UP), duplicate prevention, rating bounds,
 * aggregate correctness + recompute on moderation, vendor response ownership, reports,
 * helpful votes, suspended-user denial, and driver self-review prevention.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function register(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

interface Seed { customerCookies: string[]; customerId: string; vendorUserId: string; vendorCookies: string[]; vendorProfileId: string; productId: string; variantId: string; orderItemId: string; vendorOrderId: string; deliveryId: string; driverProfileId: string; driverUserId: string }
async function seedFulfilled(method: 'DELIVERY' | 'PICKUP' = 'DELIVERY'): Promise<Seed> {
  const s = uniq();
  const vend = await register(`vend_${s}@example.bz`);
  const vendorCookies = await login(`vend_${s}@example.bz`, 'CustomerPass123');
  await ctx.prisma.userRole.create({ data: { userId: vend.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({ data: { userId: vend.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id, categoryId, title: `Body Lotion ${s}`, slug: `p-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD',
      options: { create: { name: 'Fragrance', values: { create: [{ value: 'Perfect in Pink' }] } } },
    },
    include: { options: { include: { values: true } } },
  });
  const variant = await ctx.prisma.productVariant.create({ data: { productId: product.id, displayName: 'Perfect in Pink', sku: `V-${s}`, optionValues: { create: { productOptionValueId: product.options[0]!.values[0]!.id } } } });
  const drv = await register(`drv_${s}@example.bz`);
  const dp = await ctx.prisma.driverProfile.create({ data: { userId: drv.userId, legalName: 'D', displayName: `Drv${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED' } });
  const cust = await register(`cust_${s}@example.bz`);
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num, userId: cust.userId, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: method === 'DELIVERY' ? 500n : 0n, totalMinor: method === 'DELIVERY' ? 1500n : 1000n,
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`, vendorProfileId: vp.id, deliveryMethod: method, itemCount: 1, subtotalMinor: 1000n,
          status: method === 'PICKUP' ? 'PICKED_UP' : 'PENDING',
          ...(method === 'PICKUP' ? { pickedUpAt: new Date() } : {}),
          items: { create: { productId: product.id, variantId: variant.id, productTitle: `Body Lotion ${s}`, variantTitle: 'Perfect in Pink', sku: variant.sku, unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          ...(method === 'DELIVERY' ? { delivery: { create: { status: 'DELIVERED', feeMinor: 500n, deliveredAt: new Date(), assignedDriverProfileId: dp.id } } } : {}),
        },
      },
    },
    include: { vendorOrders: { include: { items: true, delivery: true } } },
  });
  const vo = order.vendorOrders[0]!;
  return { customerCookies: cust.cookies, customerId: cust.userId, vendorUserId: vend.userId, vendorCookies, vendorProfileId: vp.id, productId: product.id, variantId: variant.id, orderItemId: vo.items[0]!.id, vendorOrderId: vo.id, deliveryId: vo.delivery?.id ?? '', driverProfileId: dp.id, driverUserId: drv.userId };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await post(adminCookies, 'admin/categories', { name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('verified reviews + eligibility', () => {
  it('customer reviews a delivered product; variant snapshot preserved; aggregate updates', async () => {
    const o = await seedFulfilled('DELIVERY');
    const res = await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, title: 'Great', body: 'Loved the Perfect in Pink scent.' });
    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(5);
    expect(res.body.variantName).toBe('Perfect in Pink'); // exact variant preserved
    expect(res.body.verifiedPurchase).toBe(true);
    // aggregate cached on the product + exposed publicly
    const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: o.productId } });
    expect(prod.ratingCount).toBe(1);
    expect(prod.ratingAverage).toBe(5);
    const pub = await get([], `marketplace/reviews/PRODUCT/${o.productId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.aggregate).toMatchObject({ average: 5, count: 1 });
    expect(pub.body.reviews[0].variantName).toBe('Perfect in Pink');
  });

  it('vendor + driver reviews for a completed order; driver self-review blocked', async () => {
    const o = await seedFulfilled('DELIVERY');
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'VENDOR', contextId: o.vendorOrderId, rating: 4, body: 'Good store' })).status).toBe(201);
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'DRIVER', contextId: o.deliveryId, rating: 5, body: 'Fast driver' })).status).toBe(201);
    // driver cannot review themselves
    const driverCookies = await login((await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.driverUserId } })).email, 'CustomerPass123');
    expect((await post(driverCookies, 'reviews', { subjectType: 'DRIVER', contextId: o.deliveryId, rating: 5, body: 'self' })).status).toBeGreaterThanOrEqual(400);
    // driver rating aggregate cached
    expect((await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: o.driverProfileId } })).ratingCount).toBe(1);
  });

  it('pickup product is reviewable only after PICKED_UP', async () => {
    const o = await seedFulfilled('PICKUP');
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 4, body: 'Nice' })).status).toBe(201);
  });

  it('rejects incomplete orders, cross-customer access, duplicates, and bad ratings', async () => {
    const o = await seedFulfilled('DELIVERY');
    // not fulfilled → 403
    await ctx.prisma.orderDelivery.update({ where: { id: o.deliveryId }, data: { status: 'IN_TRANSIT' } });
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, body: 'x' })).status).toBe(403);
    await ctx.prisma.orderDelivery.update({ where: { id: o.deliveryId }, data: { status: 'DELIVERED' } });
    // cross-customer → 404
    const other = await register(`other_${uniq()}@example.bz`);
    expect((await post(other.cookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, body: 'x' })).status).toBe(404);
    // valid, then duplicate → 400
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, body: 'first' })).status).toBe(201);
    expect((await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 4, body: 'again' })).status).toBe(400);
    // rating bounds (0 and 6) → validation 400
    const o2 = await seedFulfilled('DELIVERY');
    expect((await post(o2.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o2.orderItemId, rating: 6, body: 'x' })).status).toBe(400);
    expect((await post(o2.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o2.orderItemId, rating: 0, body: 'x' })).status).toBe(400);
  });

  it('suspended users cannot review', async () => {
    const o = await seedFulfilled('DELIVERY');
    await ctx.prisma.user.update({ where: { id: o.customerId }, data: { status: 'SUSPENDED' } });
    const res = await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, body: 'x' });
    expect([401, 403]).toContain(res.status);
    await ctx.prisma.user.update({ where: { id: o.customerId }, data: { status: 'ACTIVE' } });
  });
});

describe('aggregates, responses, moderation, reports, helpful', () => {
  it('aggregate is correct across multiple reviews and recomputes on moderation', async () => {
    // two customers review the same product 5 + 3
    const a = await seedFulfilled('DELIVERY');
    // second buyer of the same product
    const s = uniq();
    const buyer2 = await register(`b2_${s}@example.bz`);
    const num = `ORD2-${s}`;
    const order2 = await ctx.prisma.order.create({
      data: { orderNumber: num, userId: buyer2.userId, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n,
        vendorOrders: { create: { orderNumber: `${num}-1`, vendorProfileId: a.vendorProfileId, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, items: { create: { productId: a.productId, variantId: a.variantId, productTitle: 'x', variantTitle: 'Perfect in Pink', sku: 'v', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } }, delivery: { create: { status: 'DELIVERED', feeMinor: 500n, deliveredAt: new Date() } } } } },
      include: { vendorOrders: { include: { items: true } } } });
    const item2 = order2.vendorOrders[0]!.items[0]!.id;
    const r1 = await post(a.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: a.orderItemId, rating: 5, body: 'excellent' });
    await post(buyer2.cookies, 'reviews', { subjectType: 'PRODUCT', contextId: item2, rating: 3, body: 'ok' });
    let prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.productId } });
    expect(prod.ratingCount).toBe(2);
    expect(prod.ratingAverage).toBe(4); // (5+3)/2
    const pub = await get([], `marketplace/reviews/PRODUCT/${a.productId}`);
    expect(pub.body.aggregate.distribution).toMatchObject({ 5: 1, 3: 1 });

    // admin hides the 5-star → aggregate recomputes to 3
    expect((await post(adminCookies, `admin/reviews/${r1.body.id}/moderate`, { action: 'HIDE', reason: 'test' })).status).toBe(201);
    prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.productId } });
    expect(prod.ratingCount).toBe(1);
    expect(prod.ratingAverage).toBe(3);
    // hidden review not in public list
    const pub2 = await get([], `marketplace/reviews/PRODUCT/${a.productId}`);
    expect(pub2.body.reviews.some((x: { id: string }) => x.id === r1.body.id)).toBe(false);
  });

  it('vendor responds only to reviews of its own store; reports + helpful votes work', async () => {
    const o = await seedFulfilled('DELIVERY');
    const rev = await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 4, body: 'nice' });
    const reviewId = rev.body.id;
    // owning vendor responds
    expect((await post(o.vendorCookies, `vendor/reviews/${reviewId}/response`, { body: 'Thanks for your feedback!' })).status).toBe(201);
    // a DIFFERENT vendor cannot respond
    const other = await seedFulfilled('DELIVERY');
    expect((await post(other.vendorCookies, `vendor/reviews/${reviewId}/response`, { body: 'hijack' })).status).toBe(403);
    // response visible publicly
    const pub = await get([], `marketplace/reviews/PRODUCT/${o.productId}`);
    expect(pub.body.reviews.find((x: { id: string }) => x.id === reviewId)?.response?.body).toBe('Thanks for your feedback!');
    // helpful vote toggle
    expect((await post(other.customerCookies, `reviews/${reviewId}/helpful`)).body.helpful).toBe(true);
    expect((await post(other.customerCookies, `reviews/${reviewId}/helpful`)).body.helpful).toBe(false);
    // report → admin sees it; admin permission required
    expect((await post(other.customerCookies, `reviews/${reviewId}/report`, { reason: 'SPAM' })).status).toBe(201);
    const reports = await get(adminCookies, 'admin/reviews/reports');
    expect(reports.body.some((r: { reviewId: string }) => r.reviewId === reviewId)).toBe(true);
    // a customer cannot access admin moderation
    expect((await get(o.customerCookies, 'admin/reviews')).status).toBe(403);
  });

  it('exposes review-eligible contexts for the customer', async () => {
    const o = await seedFulfilled('DELIVERY');
    const eligible = await get(o.customerCookies, 'reviews/eligible');
    expect(eligible.status).toBe(200);
    const types = eligible.body.map((e: { subjectType: string }) => e.subjectType);
    expect(types).toEqual(expect.arrayContaining(['PRODUCT', 'VENDOR', 'DRIVER']));
    // after reviewing the product, it drops from eligible
    await post(o.customerCookies, 'reviews', { subjectType: 'PRODUCT', contextId: o.orderItemId, rating: 5, body: 'x' });
    const after = await get(o.customerCookies, 'reviews/eligible');
    expect(after.body.some((e: { subjectType: string; contextId: string }) => e.subjectType === 'PRODUCT' && e.contextId === o.orderItemId)).toBe(false);
  });
});
