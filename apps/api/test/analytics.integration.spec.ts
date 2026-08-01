/**
 * Analytics & Reporting (Phase 4 · M22) — integration vs real Postgres. Read-only
 * aggregation over seeded paid orders + POSTED settlements: admin platform overview /
 * time-series / top lists / CSV (gated by analytics.read), and vendor OWN-storefront
 * analytics (ownership-scoped, isolated across vendors). No money movement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

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
async function makeVendor() {
  const s = uniq();
  const v = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vendorCookies = await login(`vend_${s}@example.bz`, 'CustomerPass123');
  const vp = await ctx.prisma.vendorProfile.create({ data: { userId: v.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
  const product = await ctx.prisma.product.create({ data: { vendorProfileId: vp.id, categoryId, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD' } });
  return { vendorCookies, vendorProfileId: vp.id, productId: product.id, productTitle: product.title };
}

/** Seed a fully paid, settled single-vendor order (subtotal 1000 × qty). */
async function seedPaidOrder(v: { vendorProfileId: string; productId: string; productTitle: string }, qty = 2) {
  const s = uniq();
  const buyer = await register(`buy_${s}@example.bz`);
  const subtotal = BigInt(1000 * qty);
  const delivery = 500n;
  const total = subtotal + delivery;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `ORD-${s}`, userId: buyer.userId, status: 'PENDING', itemCount: qty, subtotalMinor: subtotal, deliveryFeeMinor: delivery, totalMinor: total,
      vendorOrders: {
        create: {
          orderNumber: `ORD-${s}-1`, vendorProfileId: v.vendorProfileId, deliveryMethod: 'DELIVERY', itemCount: qty, subtotalMinor: subtotal, status: 'PICKED_UP', pickedUpAt: new Date(),
          items: { create: { productId: v.productId, productTitle: v.productTitle, sku: `SK-${s}`, unitPriceMinor: 1000n, quantity: qty, subtotalMinor: subtotal } },
        },
      },
      payment: { create: { paymentNumber: `PAY-${s}`, userId: buyer.userId, amountMinor: total, currency: 'BZD', status: 'SETTLED', authorizedAt: new Date() } },
    },
    include: { vendorOrders: true, payment: true },
  });
  const vo = order.vendorOrders[0]!;
  // POSTED settlement (matches the M18 engine): 10% commission on merchandise,
  // driver 80% of delivery fee, platformFee = platform's delivery-fee share only.
  const commission = subtotal / 10n;
  const driver = (delivery * 80n) / 100n;
  const platformFee = delivery - driver; // platform's share of the delivery fee
  await ctx.prisma.vendorSettlement.create({
    data: {
      vendorProfileId: v.vendorProfileId, vendorOrderId: vo.id, paymentId: order.payment!.id, currency: 'BZD',
      merchandiseSubtotalMinor: subtotal, deliveryFeeMinor: delivery, commissionMinor: commission, driverAllocationMinor: driver,
      platformFeeMinor: platformFee, grossMinor: total, netMinor: subtotal - commission, status: 'POSTED', postedAt: new Date(), snapshot: {},
    },
  });
  // platform REVENUE = commission + platformFee (what the analytics service sums).
  return { total: Number(total), subtotal: Number(subtotal), commission: Number(commission), platform: Number(commission + platformFee), net: Number(subtotal - commission), qty };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('admin platform analytics (analytics.read)', () => {
  it('aggregates GMV, platform revenue, units, and top lists from paid+settled orders', async () => {
    const v = await makeVendor();
    const a = await seedPaidOrder(v, 2);
    const b = await seedPaidOrder(v, 3);

    const ov = await get(adminCookies, 'admin/analytics/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.gmvMinor).toBe(a.total + b.total);
    expect(ov.body.paidOrders).toBe(2);
    expect(ov.body.unitsSold).toBe(a.qty + b.qty);
    expect(ov.body.platformRevenueMinor).toBe(a.platform + b.platform);
    expect(ov.body.aovMinor).toBe(Math.round((a.total + b.total) / 2));
    expect(ov.body.approvedVendors).toBeGreaterThanOrEqual(1);

    const sales = await get(adminCookies, 'admin/analytics/sales?days=7');
    expect(sales.body.series).toHaveLength(7);
    const today = sales.body.series[sales.body.series.length - 1];
    expect(today.orders).toBe(2); // both payments are "today"
    expect(today.grossMinor).toBe(a.total + b.total);

    const topP = await get(adminCookies, 'admin/analytics/top-products');
    expect(topP.body[0]).toMatchObject({ productId: v.productId, unitsSold: a.qty + b.qty });
    const topV = await get(adminCookies, 'admin/analytics/top-vendors');
    expect(topV.body[0]).toMatchObject({ vendorProfileId: v.vendorProfileId, orders: 2 });
  });

  it('exports an orders CSV with the right content type + header', async () => {
    const res = await get(adminCookies, 'admin/analytics/reports/orders.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('orders-report.csv');
    expect(res.text.split('\r\n')[0]).toBe('orderNumber,createdAt,status,paymentStatus,itemCount,subtotalMinor,deliveryFeeMinor,totalMinor,vendors');
    expect(res.text).toContain('SETTLED');
  });

  it('gates analytics behind analytics.read (customer 403, guest 401, limited admin 403)', async () => {
    const cust = await register(`c_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'admin/analytics/overview')).status).toBe(403);
    expect((await request(ctx.server).get('/api/admin/analytics/overview')).status).toBe(401);
    // an admin WITHOUT analytics.read is refused
    const limited = await seedLimitedAdmin(ctx.prisma, `la_${uniq()}@example.bz`, ['users.read']);
    const lc = await login(limited.email, limited.password);
    expect((await get(lc, 'admin/analytics/overview')).status).toBe(403);
  });
});

describe('vendor own-storefront analytics (ownership-scoped)', () => {
  it('shows a vendor only their own sales + net revenue, isolated from other vendors', async () => {
    const v1 = await makeVendor();
    const v2 = await makeVendor();
    const s1 = await seedPaidOrder(v1, 4);

    const ov1 = await get(v1.vendorCookies, 'vendor/analytics/overview');
    expect(ov1.status).toBe(200);
    expect(ov1.body.paidOrders).toBe(1);
    expect(ov1.body.grossSalesMinor).toBe(s1.subtotal);
    expect(ov1.body.unitsSold).toBe(s1.qty);
    expect(ov1.body.netRevenueMinor).toBe(s1.net);
    expect(ov1.body.commissionPaidMinor).toBe(s1.commission);

    // v2 has no sales → all zeros (isolation)
    const ov2 = await get(v2.vendorCookies, 'vendor/analytics/overview');
    expect(ov2.body.paidOrders).toBe(0);
    expect(ov2.body.grossSalesMinor).toBe(0);
    expect(ov2.body.netRevenueMinor).toBe(0);

    const topP = await get(v1.vendorCookies, 'vendor/analytics/top-products');
    expect(topP.body[0]).toMatchObject({ productId: v1.productId, unitsSold: s1.qty });

    const csv = await get(v1.vendorCookies, 'vendor/analytics/reports/orders.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('my-orders-report.csv');
    expect(csv.text.split('\r\n')[0]).toContain('vendorOrderNumber');
  });

  it('rejects non-vendors from the vendor analytics surface', async () => {
    const cust = await register(`c2_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'vendor/analytics/overview')).status).toBe(403);
    expect((await request(ctx.server).get('/api/vendor/analytics/overview')).status).toBe(401);
  });
});
