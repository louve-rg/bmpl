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
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

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

/** An approved DELIVERY_DRIVER, real by default — flip to simulation via the admin test-mode endpoint, same as production would. */
async function makeApprovedDriver() {
  const s = uniq();
  const d = await register(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: d.userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  const dp = await ctx.prisma.driverProfile.create({
    data: { userId: d.userId, legalName: 'D', displayName: `Drv${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED' },
  });
  return { driverProfileId: dp.id };
}

/** Seed a fully paid, settled single-vendor order (subtotal 1000 × qty). */
async function seedPaidOrder(v: { vendorProfileId: string; productId: string; productTitle: string }, qty = 2, opts: { isTest?: boolean } = {}) {
  const s = uniq();
  const buyer = await register(`buy_${s}@example.bz`);
  const subtotal = BigInt(1000 * qty);
  const delivery = 500n;
  const total = subtotal + delivery;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `ORD-${s}`, userId: buyer.userId, status: 'PENDING', itemCount: qty, subtotalMinor: subtotal, deliveryFeeMinor: delivery, totalMinor: total, isTest: opts.isTest ?? false,
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

/** Seed an order whose settlement is still PENDING (not yet posted) — exactly the state vendorOverview's own pendingSettlements counts. */
async function seedPendingSettlementOrder(v: { vendorProfileId: string; productId: string; productTitle: string }, opts: { isTest?: boolean } = {}) {
  const s = uniq();
  const buyer = await register(`pend_${s}@example.bz`);
  const subtotal = 1000n;
  const delivery = 500n;
  const total = subtotal + delivery;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `ORDP-${s}`, userId: buyer.userId, status: 'PENDING', itemCount: 1, subtotalMinor: subtotal, deliveryFeeMinor: delivery, totalMinor: total, isTest: opts.isTest ?? false,
      vendorOrders: {
        create: {
          orderNumber: `ORDP-${s}-1`, vendorProfileId: v.vendorProfileId, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: subtotal, status: 'PICKED_UP', pickedUpAt: new Date(),
          items: { create: { productId: v.productId, productTitle: v.productTitle, sku: `SKP-${s}`, unitPriceMinor: 1000n, quantity: 1, subtotalMinor: subtotal } },
        },
      },
      payment: { create: { paymentNumber: `PAYP-${s}`, userId: buyer.userId, amountMinor: total, currency: 'BZD', status: 'SETTLED', authorizedAt: new Date() } },
    },
    include: { vendorOrders: true, payment: true },
  });
  const vo = order.vendorOrders[0]!;
  await ctx.prisma.vendorSettlement.create({
    data: {
      vendorProfileId: v.vendorProfileId, vendorOrderId: vo.id, paymentId: order.payment!.id, currency: 'BZD',
      merchandiseSubtotalMinor: subtotal, deliveryFeeMinor: delivery, commissionMinor: 100n, driverAllocationMinor: 400n,
      platformFeeMinor: 100n, grossMinor: total, netMinor: 900n, status: 'PENDING', snapshot: {},
    },
  });
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
    // gmvMinor/paidOrders/unitsSold/platformRevenueMinor/today.orders/
    // today.grossMinor are platform-wide aggregates, shared across every test
    // in this file — correct as absolute values today only because this
    // happens to be the first test to seed a paid order. Snapshot before
    // seeding and assert this test's own contribution as a delta, so the
    // check does not depend on running first (BMPL-249). Delta rather than
    // a range (toBeGreaterThanOrEqual): a range would still pass if a bad
    // join double-counted this test's own orders, which is the more likely
    // real defect on an aggregate endpoint.
    const before = await get(adminCookies, 'admin/analytics/overview');
    const salesBefore = await get(adminCookies, 'admin/analytics/sales?days=7');
    const todayBefore = salesBefore.body.series[salesBefore.body.series.length - 1];

    const v = await makeVendor();
    const a = await seedPaidOrder(v, 2);
    const b = await seedPaidOrder(v, 3);

    const ov = await get(adminCookies, 'admin/analytics/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.gmvMinor - before.body.gmvMinor).toBe(a.total + b.total);
    expect(ov.body.paidOrders - before.body.paidOrders).toBe(2);
    expect(ov.body.unitsSold - before.body.unitsSold).toBe(a.qty + b.qty);
    expect(ov.body.platformRevenueMinor - before.body.platformRevenueMinor).toBe(a.platform + b.platform);
    // aovMinor is an AVERAGE, not additive — subtracting the snapshot would
    // produce a subtly wrong number that still happens to pass. Recompute it
    // from the same before/after totals the server itself combines.
    const gmvAfter = before.body.gmvMinor + a.total + b.total;
    const paidOrdersAfter = before.body.paidOrders + 2;
    expect(ov.body.aovMinor).toBe(Math.round(gmvAfter / paidOrdersAfter));
    // Already correctly hedged (whoever wrote this knew for THIS one field) —
    // left as-is.
    expect(ov.body.approvedVendors).toBeGreaterThanOrEqual(1);

    const sales = await get(adminCookies, 'admin/analytics/sales?days=7');
    expect(sales.body.series).toHaveLength(7);
    const today = sales.body.series[sales.body.series.length - 1];
    expect(today.orders - todayBefore.orders).toBe(2); // both payments are "today"
    expect(today.grossMinor - todayBefore.grossMinor).toBe(a.total + b.total);

    // Platform-wide ranking, not a lookup or an absolute value on shared
    // state — a THIRD shape (BMPL-250). Position depends on every other
    // test's data (whichever product/vendor another test happened to sell
    // more of ranks first), but membership and this entry's own value do
    // not. Assert this test's own product/vendor is present with the right
    // count, not that it ranks first.
    const topP = await get(adminCookies, 'admin/analytics/top-products');
    const topPEntry = topP.body.find((p: { productId: string }) => p.productId === v.productId);
    expect(topPEntry).toMatchObject({ productId: v.productId, unitsSold: a.qty + b.qty });
    const topV = await get(adminCookies, 'admin/analytics/top-vendors');
    const topVEntry = topV.body.find((x: { vendorProfileId: string }) => x.vendorProfileId === v.vendorProfileId);
    expect(topVEntry).toMatchObject({ vendorProfileId: v.vendorProfileId, orders: 2 });
  });

  it('exports an orders CSV with the right content type + header', async () => {
    const res = await get(adminCookies, 'admin/analytics/reports/orders.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('orders-report.csv');
    expect(res.text.split('\r\n')[0]).toBe('orderNumber,createdAt,status,paymentStatus,itemCount,subtotalMinor,deliveryFeeMinor,totalMinor,vendors');
    expect(res.text).toContain('SETTLED');
  });

  /**
   * MDF-777 exclusion #3: `adminOverview`'s `vendorSettlement.aggregate`
   * (analytics.service.ts:72) had no isTest filter at all — the one
   * aggregate in this method missing the `NOT_TEST` pattern every sibling
   * here already uses (gmvAgg, order counts, unitsAgg). Same delta
   * discipline as the first test in this file (BMPL-249): snapshot before
   * seeding, assert only this test's own real contribution.
   */
  it('MDF-777 exclusion #3: platformRevenueMinor/vendorNetMinor exclude a simulation settlement, include a real one', async () => {
    const before = await get(adminCookies, 'admin/analytics/overview');
    const v = await makeVendor();
    // The simulation order exists (proving genuine exclusion, not absence)
    // — only the real order's numbers are asserted below.
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });
    const ov = await get(adminCookies, 'admin/analytics/overview');
    expect(ov.body.platformRevenueMinor - before.body.platformRevenueMinor).toBe(real.platform);
    expect(ov.body.vendorNetMinor - before.body.vendorNetMinor).toBe(real.net);
  });

  /**
   * MDF-777 exclusion #3 (tenth-class read, closed alongside #761):
   * `approvedDrivers` (analytics.service.ts:80) counted every APPROVED
   * DELIVERY_DRIVER UserRole with no isTest filter at all. `UserRole` has no
   * isTest column of its own, so the fix joins `DriverProfile.isTest` — the
   * SAME flag `DriverService.assignmentEligibility`/`eligibleDriversForDistrict`
   * already trust for the real-dispatch exclusion (Q1, driver.service.ts),
   * not the separate `User.isTest`, so this count agrees with the mechanism
   * that actually governs who gets offered work. Checked both directions,
   * on the delta, same discipline as every other test in this file: a test
   * driver must move it by nothing, a real one right after by exactly one.
   */
  it('MDF-777 exclusion #3: approvedDrivers excludes a simulation driver and still includes a real one', async () => {
    const before = await get(adminCookies, 'admin/analytics/overview');

    const sim = await makeApprovedDriver();
    expect((await patch(adminCookies, `admin/drivers/${sim.driverProfileId}/test-mode`, { isTest: true, reason: 'MDF-777 analytics isolation test.' })).status).toBe(200);
    const midSim = await get(adminCookies, 'admin/analytics/overview');
    expect(midSim.body.approvedDrivers - before.body.approvedDrivers).toBe(0);

    await makeApprovedDriver();
    const after = await get(adminCookies, 'admin/analytics/overview');
    expect(after.body.approvedDrivers - before.body.approvedDrivers).toBe(1);
  });

  /**
   * MDF-777 exclusion #3: `publishedProducts` (analytics.service.ts:82)
   * counted every PUBLISHED product with no join to its vendor at all.
   * `Product` has no isTest of its own (confirmed against the UAT Walk
   * Widget fixture, which is why that count is not visibly wrong today —
   * its vendor is deliberately isTest:false), so the fix joins
   * `vendorProfile.isTest`. Same both-directions delta discipline.
   */
  it('MDF-777 exclusion #3: publishedProducts excludes a simulation vendor\'s product and still includes a real one', async () => {
    const before = await get(adminCookies, 'admin/analytics/overview');

    const sim = await makeVendor();
    expect((await patch(adminCookies, `admin/vendors/${sim.vendorProfileId}/test-mode`, { isTest: true, reason: 'MDF-777 analytics isolation test.' })).status).toBe(200);
    const midSim = await get(adminCookies, 'admin/analytics/overview');
    expect(midSim.body.publishedProducts - before.body.publishedProducts).toBe(0);

    await makeVendor();
    const after = await get(adminCookies, 'admin/analytics/overview');
    expect(after.body.publishedProducts - before.body.publishedProducts).toBe(1);
  });

  /**
   * MDF-777 exclusion #3: `totalCustomers` (analytics.service.ts:81) was
   * `user.count()` with no `where` at all — wrong on two axes at once, not
   * filtered for isTest AND not scoped to the customer role, so it counted
   * every user of every role (admins, vendors, drivers, UAT fixtures) as a
   * "customer". The owner's decision: count non-test users holding the
   * CUSTOMER role specifically — every registration creates an APPROVED
   * CUSTOMER UserRole (`auth.service.ts`), so this is not ambiguous even
   * though the same user may also hold other roles (a vendor is a customer
   * too, and correctly still counted as one). Same both-directions delta.
   */
  it('MDF-777 exclusion #3: totalCustomers excludes a simulation user and still includes a real one', async () => {
    const before = await get(adminCookies, 'admin/analytics/overview');

    const sim = await register(`cust_sim_${uniq()}@example.bz`);
    expect((await post(adminCookies, 'admin/users/test-flag', { userId: sim.userId, isTest: true, reason: 'MDF-777 analytics isolation test.' })).status).toBe(201);
    const midSim = await get(adminCookies, 'admin/analytics/overview');
    expect(midSim.body.totalCustomers - before.body.totalCustomers).toBe(0);

    await register(`cust_real_${uniq()}@example.bz`);
    const after = await get(adminCookies, 'admin/analytics/overview');
    expect(after.body.totalCustomers - before.body.totalCustomers).toBe(1);
  });

  /**
   * MDF-777 exclusion #3 (raw-SQL group, read #1 of 5): `adminSales` summed
   * ALL payments via a raw query with NO join to orders at all — there was
   * no hop to isTest in existence. Fixed by adding the join
   * (payments."orderId" -> orders."isTest"), a structural change to the
   * query rather than a WHERE-only addition like the other four reads in
   * this group. Delta against today's bucket, same discipline as the first
   * test in this file: a simulation order existing in the same window must
   * not move it.
   */
  it('MDF-777 exclusion #3: adminSales (gross/orders time series) excludes a simulation order from today\'s bucket', async () => {
    const salesBefore = await get(adminCookies, 'admin/analytics/sales?days=7');
    const todayBefore = salesBefore.body.series[salesBefore.body.series.length - 1];

    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const sales = await get(adminCookies, 'admin/analytics/sales?days=7');
    const today = sales.body.series[sales.body.series.length - 1];
    expect(today.orders - todayBefore.orders).toBe(1);
    expect(today.grossMinor - todayBefore.grossMinor).toBe(real.total);
  });

  /**
   * MDF-777 exclusion #3 (raw-SQL group, read #2 of 5): `adminTopProducts`
   * already joined orders but never filtered on it. A fresh vendor/product
   * pair isolates this test's own entry in a platform-wide ranking.
   */
  it('MDF-777 exclusion #3: adminTopProducts excludes a simulation order\'s units/revenue', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const topP = await get(adminCookies, 'admin/analytics/top-products');
    const entry = topP.body.find((p: { productId: string }) => p.productId === v.productId);
    expect(entry).toMatchObject({ productId: v.productId, unitsSold: real.qty, revenueMinor: real.subtotal });
  });

  /**
   * MDF-777 exclusion #3 (raw-SQL group, read #3 of 5): `adminTopVendors`,
   * same gap as adminTopProducts, same fresh-vendor isolation.
   */
  it('MDF-777 exclusion #3: adminTopVendors excludes a simulation order\'s revenue/order count', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const topV = await get(adminCookies, 'admin/analytics/top-vendors');
    const entry = topV.body.find((x: { vendorProfileId: string }) => x.vendorProfileId === v.vendorProfileId);
    expect(entry).toMatchObject({ vendorProfileId: v.vendorProfileId, orders: 1, revenueMinor: real.subtotal });
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

  /**
   * MDF-777 exclusion #3, vendor-scoped: `vendorOverview`'s own
   * `vendorSettlement.aggregate` (analytics.service.ts:176) had the same gap
   * as adminOverview's above. A brand-new vendor starts at absolute zero, so
   * no delta is needed here — `netRevenueMinor`/`commissionPaidMinor` come
   * from the aggregate this fix touched and must reflect only the real
   * order.
   */
  it('MDF-777 exclusion #3: a vendor\'s own netRevenueMinor/commissionPaidMinor exclude a simulation settlement', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const ov = await get(v.vendorCookies, 'vendor/analytics/overview');
    expect(ov.body.netRevenueMinor).toBe(real.net);
    expect(ov.body.commissionPaidMinor).toBe(real.commission);
    expect(ov.body.settledGrossMinor).toBe(real.total);
  });

  /**
   * MDF-777 exclusion #3 (sixth unfiltered read): `vendorOverview`'s
   * `vendorOrder.aggregate` (`paidAgg`, analytics.service.ts:179) fed
   * `paidOrders`/`grossSalesMinor` with no isTest filter at all — the one
   * sibling aggregate in this method still missing the NOT_TEST pattern
   * `unitsAgg` right below it already uses. A brand-new vendor starts at
   * absolute zero, so the simulation order's own count/subtotal would show
   * up directly if the filter were missing.
   */
  it('MDF-777 exclusion #3 (sixth read): a vendor\'s own paidOrders/grossSalesMinor exclude a simulation order', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const ov = await get(v.vendorCookies, 'vendor/analytics/overview');
    expect(ov.body.paidOrders).toBe(1);
    expect(ov.body.grossSalesMinor).toBe(real.subtotal);
  });

  /**
   * MDF-777 exclusion #3: `vendorOverview`'s own `vendorSettlement.count`
   * (`pendingSettlements`) had no isTest filter — a simulation order's own
   * PENDING settlement would show up in a vendor's own count of real
   * outstanding settlements. A brand-new vendor starts at absolute zero.
   */
  it('MDF-777 exclusion #3: a vendor\'s own pendingSettlements excludes a simulation order\'s pending settlement', async () => {
    const v = await makeVendor();
    await seedPendingSettlementOrder(v, { isTest: true });
    await seedPendingSettlementOrder(v, { isTest: false });

    const ov = await get(v.vendorCookies, 'vendor/analytics/overview');
    expect(ov.body.pendingSettlements).toBe(1);
  });

  /**
   * MDF-777 exclusion #3 (raw-SQL group, read #4 of 5): `vendorSales`
   * already joined orders but never filtered on it. Brand-new vendor starts
   * at zero, so the simulation order's own contribution would show up
   * directly if the filter were missing.
   */
  it('MDF-777 exclusion #3: vendorSales excludes a simulation order from today\'s bucket', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const sales = await get(v.vendorCookies, 'vendor/analytics/sales?days=7');
    const today = sales.body.series[sales.body.series.length - 1];
    expect(today.orders).toBe(1);
    expect(today.grossMinor).toBe(real.subtotal);
  });

  /**
   * MDF-777 exclusion #3 (raw-SQL group, read #5 of 5): `vendorTopProducts`,
   * same gap, same brand-new-vendor isolation.
   */
  it('MDF-777 exclusion #3: vendorTopProducts excludes a simulation order\'s units/revenue', async () => {
    const v = await makeVendor();
    await seedPaidOrder(v, 2, { isTest: true });
    const real = await seedPaidOrder(v, 3, { isTest: false });

    const topP = await get(v.vendorCookies, 'vendor/analytics/top-products');
    expect(topP.body[0]).toMatchObject({ productId: v.productId, unitsSold: real.qty, revenueMinor: real.subtotal });
  });

  it('rejects non-vendors from the vendor analytics surface', async () => {
    const cust = await register(`c2_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'vendor/analytics/overview')).status).toBe(403);
    expect((await request(ctx.server).get('/api/vendor/analytics/overview')).status).toBe(401);
  });
});
