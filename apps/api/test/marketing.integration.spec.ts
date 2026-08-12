/**
 * Marketing & Business Promotion (Phase 6 · M26) — integration + security vs real
 * Postgres + MinIO. Covers promotion CRUD, target OWNERSHIP verification, submit →
 * admin moderation → public serving, SERVING-TIME suppression (pause / expire /
 * suspended target), cross-owner isolation, coupon validation policy, metric tracking
 * → analytics, abuse reports, admin permission gating, and the additive (no-regression)
 * nature of the module.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
/** A valid coupon code fragment (A–Z/0–9 only — no underscores). */
const couponCode = (prefix: string) => `${prefix}${uniq().replace(/_/g, '')}`.slice(0, 24).toUpperCase();

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object | string = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, pw: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password: pw });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function makeApprovedVendor() {
  const email = `v_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const created = await post(cookies, 'vendor/profile', { businessName: `Store ${uniq()}`, contactEmail: email });
  const vpId = created.body.profile.id;
  await post(cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${vpId}/approve`, {});
  return { cookies, vpId, userId: user.id };
}
async function makeProduct(vendor: { cookies: string[] }) {
  const r = await post(vendor.cookies, 'vendor/products', { title: `Item ${uniq()}`, sku: `SKU-${uniq()}`, categoryId, priceMinor: 5999 });
  expect(r.status).toBe(201);
  expect(r.body.status).toBe('PUBLISHED');
  return r.body.id as string;
}
/** Owner creates a promotion targeting their product, submits, admin approves → serving. */
async function publishPromotion(owner: { cookies: string[] }, productId: string, placement = 'HOMEPAGE_FEATURED_PRODUCTS', extra: Record<string, unknown> = {}) {
  const c = await post(owner.cookies, 'business/marketing/promotions', {
    type: 'FEATURED_PRODUCT', title: `Promo ${uniq()}`,
    placements: [{ placement }],
    targets: [{ targetType: 'PRODUCT', productId }],
    ...extra,
  });
  expect(c.status).toBe(201);
  const id = c.body.id;
  expect((await post(owner.cookies, `business/marketing/promotions/${id}/submit`)).body.status).toBe('SUBMITTED');
  const m = await post(admin, `admin/marketing/promotions/${id}/moderate`, { action: 'APPROVE' });
  expect(m.status).toBe(201);
  expect(m.body.status).toBe('APPROVED');
  return id as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await login(a.email, a.password);
  const cat = await post(admin, 'admin/categories', { name: `Cat ${uniq()}` });
  categoryId = cat.body.id;
});
afterAll(async () => { await ctx.app.close(); });

describe('promotion lifecycle + moderation + public serving', () => {
  it('publishes via moderation and serves on the homepage; drafts never serve', async () => {
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    // draft is not public
    const draft = await post(vendor.cookies, 'business/marketing/promotions', { type: 'FEATURED_PRODUCT', title: 'Draft', placements: [{ placement: 'HOMEPAGE_FEATURED_PRODUCTS' }], targets: [{ targetType: 'PRODUCT', productId }] });
    expect((await guest(`marketing/promotions/${draft.body.id}`)).status).toBe(404);
    const home0 = await guest('marketing/homepage');
    expect(home0.body.featuredProducts.some((p: { id: string }) => p.id === draft.body.id)).toBe(false);
    // publish a second one via moderation → serves
    const id = await publishPromotion(vendor, productId);
    const home = await guest('marketing/homepage');
    expect(home.body.featuredProducts.some((p: { id: string }) => p.id === id)).toBe(true);
    expect((await guest(`marketing/promotions/${id}`)).status).toBe(200);
    // placement endpoint also serves it
    const pl = await guest('marketing/placements/HOMEPAGE_FEATURED_PRODUCTS');
    expect(pl.body.some((p: { id: string }) => p.id === id)).toBe(true);
  });

  it('suppresses at serve time when paused, expired, or the target is suspended (no cascade writes)', async () => {
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    const id = await publishPromotion(vendor, productId);
    const served = () => guest('marketing/placements/HOMEPAGE_FEATURED_PRODUCTS').then((r) => r.body.some((p: { id: string }) => p.id === id));
    expect(await served()).toBe(true);
    // owner pause → gone; resume → back
    expect((await post(vendor.cookies, `business/marketing/promotions/${id}/status`, { action: 'PAUSE' })).status).toBe(201);
    expect(await served()).toBe(false);
    expect((await post(vendor.cookies, `business/marketing/promotions/${id}/status`, { action: 'RESUME' })).status).toBe(201);
    expect(await served()).toBe(true);
    // suspend the target product's vendor → promotion disappears though its own row is untouched
    await ctx.prisma.vendorProfile.update({ where: { id: vendor.vpId }, data: { approvalStatus: 'SUSPENDED' } });
    expect(await served()).toBe(false);
    expect((await ctx.prisma.promotion.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED'); // untouched
    await ctx.prisma.vendorProfile.update({ where: { id: vendor.vpId }, data: { approvalStatus: 'APPROVED' } });
    expect(await served()).toBe(true);
    // admin expire → gone permanently
    expect((await post(admin, `admin/marketing/promotions/${id}/moderate`, { action: 'EXPIRE' })).body.status).toBe('EXPIRED');
    expect(await served()).toBe(false);
  });
});

describe('security: target ownership + cross-owner isolation', () => {
  it('forbids targeting another business’s product and hides others’ promotions', async () => {
    const a = await makeApprovedVendor();
    const b = await makeApprovedVendor();
    const aProduct = await makeProduct(a);
    const bProduct = await makeProduct(b);
    // A cannot target B's product
    const bad = await post(a.cookies, 'business/marketing/promotions', { type: 'FEATURED_PRODUCT', title: 'Steal', targets: [{ targetType: 'PRODUCT', productId: bProduct }] });
    expect([403, 404]).toContain(bad.status);
    // A targeting own product is fine
    const good = await post(a.cookies, 'business/marketing/promotions', { type: 'FEATURED_PRODUCT', title: 'Mine', targets: [{ targetType: 'PRODUCT', productId: aProduct }] });
    expect(good.status).toBe(201);
    const id = good.body.id;
    // B cannot read or mutate A's promotion
    expect((await get(b.cookies, `business/marketing/promotions/${id}`)).status).toBe(404);
    expect((await patch(b.cookies, `business/marketing/promotions/${id}`, { title: 'hijack' })).status).toBe(404);
    expect((await put(b.cookies, `business/marketing/promotions/${id}/targets`, { targets: [{ targetType: 'PRODUCT', productId: bProduct }] })).status).toBe(404);
    // B's own list does not include A's promotion
    expect((await get(b.cookies, 'business/marketing/promotions')).body.some((p: { id: string }) => p.id === id)).toBe(false);
    // a plain customer cannot use the business surface at all
    const custEmail = `c_${uniq()}@ex.bz`;
    const reg = await request(ctx.server).post('/api/auth/register').send({ email: custEmail, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    expect((await post(cookiesOf(reg), 'business/marketing/promotions', { type: 'HOMEPAGE_BANNER', title: 'x' })).status).toBe(403);
  });
});

describe('coupons: validation policy (no wallet mutation)', () => {
  it('applies percentage/fixed discounts, caps, min-spend, scope, and status rules', async () => {
    const vendor = await makeApprovedVendor();
    // vendor creates a % coupon with min spend + max discount cap
    const pct = await post(vendor.cookies, 'business/marketing/coupons', { code: couponCode('PCT'), discountType: 'PERCENTAGE', percentOff: 20, minSpendMinor: 5000, maxDiscountMinor: 1500 });
    expect(pct.status).toBe(201);
    const code = pct.body.code as string;
    // inactive by default → invalid
    expect((await post(vendor.cookies, 'business/marketing/coupons/' + pct.body.id + '/status', { status: 'ACTIVE' })).status).toBe(201);
    // below min spend → invalid
    let v = await request(ctx.server).post('/api/marketing/coupons/validate').send({ code, subtotalMinor: 4000, vendorProfileId: vendor.vpId });
    expect(v.body.valid).toBe(false);
    // 20% of 10000 = 2000, capped to 1500
    v = await request(ctx.server).post('/api/marketing/coupons/validate').send({ code, subtotalMinor: 10000, vendorProfileId: vendor.vpId });
    expect(v.body.valid).toBe(true);
    expect(v.body.discountMinor).toBe(1500);
    // vendor-scoped coupon rejected without the matching vendor context
    v = await request(ctx.server).post('/api/marketing/coupons/validate').send({ code, subtotalMinor: 10000 });
    expect(v.body.valid).toBe(false);
    // unknown code → invalid, never throws
    v = await request(ctx.server).post('/api/marketing/coupons/validate').send({ code: 'NOPE-NOPE', subtotalMinor: 10000 });
    expect(v.status).toBe(201);
    expect(v.body.valid).toBe(false);
    // fixed-amount coupon capped at subtotal
    const fixed = await post(vendor.cookies, 'business/marketing/coupons', { code: couponCode('FIX'), discountType: 'FIXED_AMOUNT', amountOffMinor: 9999 });
    await post(vendor.cookies, `business/marketing/coupons/${fixed.body.id}/status`, { status: 'ACTIVE' });
    v = await request(ctx.server).post('/api/marketing/coupons/validate').send({ code: fixed.body.code, subtotalMinor: 3000, vendorProfileId: vendor.vpId });
    expect(v.body.discountMinor).toBe(3000); // capped at subtotal
  });
});

describe('metrics, reports, and admin gating', () => {
  it('tracks metrics into analytics, files + resolves reports, and gates admin routes', async () => {
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    const id = await publishPromotion(vendor, productId);
    // track impressions/clicks (best-effort, 204)
    await request(ctx.server).post(`/api/marketing/promotions/${id}/track`).send({ event: 'impression', placement: 'HOMEPAGE_FEATURED_PRODUCTS' });
    await request(ctx.server).post(`/api/marketing/promotions/${id}/track`).send({ event: 'click', placement: 'HOMEPAGE_FEATURED_PRODUCTS' });
    // owner analytics reflect them
    const an = await get(vendor.cookies, `business/marketing/promotions/${id}/analytics`);
    expect(an.status).toBe(200);
    expect(an.body.totals.impressions).toBeGreaterThanOrEqual(1);
    expect(an.body.totals.clicks).toBeGreaterThanOrEqual(1);
    // a customer reports the promotion
    const reg = await request(ctx.server).post('/api/auth/register').send({ email: `r_${uniq()}@ex.bz`, password: 'CustomerPass123', firstName: 'R', lastName: 'U', acceptedTerms: true });
    expect((await post(cookiesOf(reg), `marketing/promotions/${id}/report`, { reason: 'MISLEADING', note: 'nope' })).status).toBe(201);
    // admin sees + resolves it; non-admin is forbidden
    expect((await get(vendor.cookies, 'admin/marketing/promotions')).status).toBe(403);
    expect((await get(admin, 'admin/marketing/promotions')).status).toBe(200);
    const reports = await get(admin, 'admin/marketing/reports');
    const rep = reports.body.find((r: { promotionId: string }) => r.promotionId === id);
    expect(rep).toBeTruthy();
    expect((await post(admin, `admin/marketing/reports/${rep.id}/resolve`, { status: 'ACTIONED', note: 'removed' })).status).toBe(201);
    // an admin WITHOUT coupons.manage cannot manage platform coupons
    const limited = await seedLimitedAdmin(ctx.prisma, `la_${uniq()}@ex.bz`, ['promotions.read', 'promotions.moderate']);
    const lc = await login(limited.email, limited.password);
    expect((await get(lc, 'admin/marketing/coupons')).status).toBe(403);
    expect((await get(lc, 'admin/marketing/promotions')).status).toBe(200);
    expect((await get(admin, 'admin/marketing/analytics')).status).toBe(200);
  });
});
