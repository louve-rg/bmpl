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
let adminUserId: string;
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
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
  adminUserId = a.id;
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

  it('a simulation storefront’s promotion never serves on a real page', async () => {
    // Sibling of the public-hubs leak: serve-time eligibility checked
    // approvalStatus but never isTest, so a rehearsal store's legitimately
    // approved promotion would appear on every real customer's homepage the
    // moment a tester ran the campaign flow. The flip goes through the
    // console endpoint — no raw write.
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    const id = await publishPromotion(vendor, productId);
    const served = () => guest('marketing/placements/HOMEPAGE_FEATURED_PRODUCTS').then((r) => r.body.some((p: { id: string }) => p.id === id));
    expect(await served()).toBe(true);

    expect((await patch(admin, `admin/vendors/${vendor.vpId}/test-mode`, { isTest: true, reason: 'Rehearsal store.' })).status).toBe(200);
    expect(await served()).toBe(false); // its own promotion row is untouched — suppressed at serve time
    expect((await patch(admin, `admin/vendors/${vendor.vpId}/test-mode`, { isTest: false, reason: 'Back to trading.' })).status).toBe(200);
    expect(await served()).toBe(true);
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

/**
 * MDF-503: TargetPicker now auto-resolves VENDOR/EMPLOYER from the caller's
 * own profile endpoint, so the UI offers no field at all for either — the
 * existing cross-owner test above only ever exercised PRODUCT, which still
 * has a picked-by-name value a crafted request could swap out. Confirms the
 * server-side verifyTargetOwnership check these two types already have is
 * still what actually stops a caller who skips the UI and posts a foreign
 * profile id directly.
 */
describe('security: VENDOR/EMPLOYER target ownership survives a crafted request (MDF-503)', () => {
  it('a vendor cannot target another vendor\'s profile by posting its id directly', async () => {
    const a = await makeApprovedVendor();
    const b = await makeApprovedVendor();
    const bad = await post(a.cookies, 'business/marketing/promotions', {
      type: 'HOMEPAGE_BANNER',
      title: 'Steal vendor',
      targets: [{ targetType: 'VENDOR', vendorProfileId: b.vpId }],
    });
    expect([403, 404]).toContain(bad.status);
    const good = await post(a.cookies, 'business/marketing/promotions', {
      type: 'HOMEPAGE_BANNER',
      title: 'Own vendor',
      targets: [{ targetType: 'VENDOR', vendorProfileId: a.vpId }],
    });
    expect(good.status).toBe(201);
  });

  it('an employer cannot target another employer\'s profile by posting its id directly', async () => {
    async function makeEmployer() {
      const email = `emp_${uniq()}@ex.bz`;
      const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'EmployerPass123', firstName: 'E', lastName: 'R', acceptedTerms: true });
      const cookies = cookiesOf(reg);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'EMPLOYER', status: 'APPROVED', approvedAt: new Date() } });
      const prof = await put(cookies, 'employer/profile', { companyName: `Acme ${uniq()}`, contactEmail: email });
      expect(prof.status).toBe(200);
      return { cookies, epId: prof.body.id as string };
    }
    const a = await makeEmployer();
    const b = await makeEmployer();
    const bad = await post(a.cookies, 'business/marketing/promotions', {
      type: 'HOMEPAGE_BANNER',
      title: 'Steal employer',
      targets: [{ targetType: 'EMPLOYER', employerProfileId: b.epId }],
    });
    expect([403, 404]).toContain(bad.status);
    const good = await post(a.cookies, 'business/marketing/promotions', {
      type: 'HOMEPAGE_BANNER',
      title: 'Own employer',
      targets: [{ targetType: 'EMPLOYER', employerProfileId: a.epId }],
    });
    expect(good.status).toBe(201);
  });
});

/**
 * MDF-503: assignPlacement previously had no existence check on categoryId
 * at all. Now: a category-context placement (CATEGORY_PAGE) must carry one,
 * it must actually exist, a NEW assignment may only target a VISIBLE
 * category, and an EXISTING assignment keeps working after its category is
 * later hidden — the asymmetry is deliberate (marketing-admin.service.ts's
 * own comment: re-validating on every edit would let a category admins no
 * longer manage break a promotion that was placed correctly at the time).
 */
describe('assignPlacement: categoryId existence, visibility, and the new-vs-existing asymmetry (MDF-503)', () => {
  async function approvedPromotionNoPlacement() {
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    const c = await post(vendor.cookies, 'business/marketing/promotions', {
      type: 'FEATURED_PRODUCT',
      title: `Promo ${uniq()}`,
      targets: [{ targetType: 'PRODUCT', productId }],
    });
    expect(c.status).toBe(201);
    const id = c.body.id as string;
    expect((await post(vendor.cookies, `business/marketing/promotions/${id}/submit`)).body.status).toBe('SUBMITTED');
    const m = await post(admin, `admin/marketing/promotions/${id}/moderate`, { action: 'APPROVE' });
    expect(m.status).toBe(201);
    return id;
  }

  it('a CATEGORY_PAGE placement without a categoryId is refused', async () => {
    const id = await approvedPromotionNoPlacement();
    const r = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE' });
    expect(r.status).toBe(400);
  });

  it('a categoryId that does not exist is refused, not silently accepted', async () => {
    const id = await approvedPromotionNoPlacement();
    const r = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId: 'does-not-exist' });
    expect(r.status).toBe(400);
  });

  it('a NEW assignment may not target a category that is already hidden', async () => {
    const id = await approvedPromotionNoPlacement();
    const hidden = await post(admin, 'admin/categories', { name: `Hidden ${uniq()}` });
    expect((await patch(admin, `admin/categories/${hidden.body.id}`, { isVisible: false })).status).toBe(200);

    const r = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId: hidden.body.id });
    expect(r.status).toBe(400);
  });

  it('an EXISTING assignment keeps working after its category is hidden later — editing it is not re-validated against visibility', async () => {
    const id = await approvedPromotionNoPlacement();
    const assign = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId });
    expect(assign.status).toBe(201);
    const placementId = assign.body.id as string;

    expect((await patch(admin, `admin/categories/${categoryId}`, { isVisible: false })).status).toBe(200);

    // Re-assigning the SAME placement/category pair on the SAME promotion
    // hits the existing-row branch (assignPlacement's own `existing` lookup
    // by promotionId+placement+categoryId) and must still succeed.
    const reassign = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId, position: 1 });
    expect(reassign.status).toBe(201);
    expect(reassign.body.id).toBe(placementId);

    // The ordinary update route for an existing placement is also untouched
    // by the category's visibility.
    const update = await patch(admin, `admin/marketing/placements/${placementId}`, { position: 2 });
    expect(update.status).toBe(200);

    // Restore visibility so this category does not leak a hidden side effect
    // into any test that runs after this one in the same file.
    expect((await patch(admin, `admin/categories/${categoryId}`, { isVisible: true })).status).toBe(200);
  });

  it('two concurrent requests to assign the SAME (promotion, placement, category) triple do not both create a row', async () => {
    // promotion_placements carries a real DB-level @@unique([promotionId,
    // placement, categoryId]) — but assignPlacement's own existence check
    // (findFirst, then create-or-update) is NOT inside a transaction, so two
    // requests racing past that read can both see `existing: null` and both
    // attempt create(). This fires them genuinely concurrently to check
    // whether the second one gets a clean, handled refusal or an unhandled
    // constraint-violation error.
    const id = await approvedPromotionNoPlacement();
    const [first, second] = await Promise.all([
      post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId }),
      post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId }),
    ]);
    const statuses = [first.status, second.status].sort();
    // Whichever request loses the race must fail CLEANLY (409/400/201 from
    // hitting the now-existing row on a retry), never a raw 500 — an
    // unhandled P2002 reaching the client is the duplicate-request failure
    // mode this check exists to catch.
    expect(statuses.every((s) => s !== 500)).toBe(true);
    const rows = await ctx.prisma.promotionPlacement.findMany({ where: { promotionId: id, placement: 'CATEGORY_PAGE', categoryId } });
    expect(rows).toHaveLength(1);
    //
    // MISSING VERIFICATION (named per owner instruction, not papered over):
    // this is a single-process Promise.all, not two separate DB connections
    // racing at the storage layer — it does NOT prove the true multi-connection
    // race is closed. It is a BEHAVIOUR assertion only (exactly one row, no
    // raw 500). The actual authority against the real race is the P2002 catch
    // added to assignPlacement (mirroring passenger-affiliation.service.ts's
    // createAsk); a two-connection concurrency harness to prove the race
    // itself was explicitly ruled out as not worth the cost (MDF-503).
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

/**
 * BMPL-212: the "promotion submitted for review" admin alert used to override
 * notifyAdmins' own ADMIN_ALERT default to PROMOTION — a category the admin
 * console's default "System & moderation" view (ADMIN_ALERT + SECURITY only)
 * never shows, so the alert was invisible unless an admin manually switched to
 * Marketing or All. The protected state is the stored `category` column,
 * asserted directly rather than the 200/201 the submit action already returns.
 */
describe('admin alert categories are not silently overridden (BMPL-212)', () => {
  it('a submitted promotion alerts admins under ADMIN_ALERT, not PROMOTION', async () => {
    const vendor = await makeApprovedVendor();
    const productId = await makeProduct(vendor);
    const c = await post(vendor.cookies, 'business/marketing/promotions', {
      type: 'FEATURED_PRODUCT', title: `Cat Promo ${uniq()}`,
      placements: [{ placement: 'HOMEPAGE_FEATURED_PRODUCTS' }],
      targets: [{ targetType: 'PRODUCT', productId }],
    });
    expect(c.status).toBe(201);
    expect((await post(vendor.cookies, `business/marketing/promotions/${c.body.id}/submit`)).status).toBe(201);
    const row = await ctx.prisma.notificationRecipient.findFirstOrThrow({
      where: { userId: adminUserId },
      include: { notification: true },
      orderBy: { id: 'desc' },
    });
    expect(row.notification.event).toBe('PROMOTION_SUBMITTED');
    expect(row.notification.category).toBe('ADMIN_ALERT');
  });
});
