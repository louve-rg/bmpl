/**
 * Admin-controlled ad placement (commerce/advertising). Marketing owns the campaign;
 * ADMIN decides where it appears. Enforces DUAL eligibility (campaign + placement),
 * device/window rules, priority ordering, and that removing a placement never deletes
 * the campaign. Builds on the M26 promotion/placement model.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, pw: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password: pw });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function makeVendor() {
  const email = `v_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const created = await post(cookies, 'vendor/profile', { businessName: `Store ${uniq()}`, contactEmail: email });
  await post(cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${created.body.profile.id}/approve`, {});
  return { cookies };
}
/** An approved banner campaign (EXTERNAL_LINK target → always "target-live"), no placement yet. */
async function approvedCampaign(biz: { cookies: string[] }, priority?: number) {
  const c = await post(biz.cookies, 'business/marketing/promotions', {
    type: 'HOMEPAGE_BANNER', title: `Ad ${uniq()}`,
    targets: [{ targetType: 'EXTERNAL_LINK', externalUrl: 'https://ad.example.bz' }],
  });
  expect(c.status).toBe(201);
  const id = c.body.id as string;
  await post(biz.cookies, `business/marketing/promotions/${id}/submit`);
  const m = await post(admin, `admin/marketing/promotions/${id}/moderate`, { action: 'APPROVE' });
  expect(m.body.status).toBe('APPROVED');
  if (priority != null) await post(admin, `admin/marketing/promotions/${id}/priority`, { priority });
  return id;
}
const inSlot = async (slot: string, id: string, qs = '') => (await guest(`marketing/placements/${slot}${qs}`)).body.some((p: { id: string }) => p.id === id);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await login(a.email, a.password);
});
afterAll(async () => { await ctx.app.close(); });

describe('admin-controlled ad placement + dual eligibility', () => {
  it('an approved campaign renders ONLY where Admin assigns it, and only while both campaign + placement are eligible', async () => {
    const biz = await makeVendor();
    const id = await approvedCampaign(biz);

    // Approved but UNPLACED → renders nowhere.
    expect(await inSlot('MARKETPLACE', id)).toBe(false);

    // Admin assigns to MARKETPLACE → now renders there, and ONLY there.
    const assign = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'MARKETPLACE' });
    expect(assign.status).toBe(201);
    const placementId = assign.body.id;
    expect(await inSlot('MARKETPLACE', id)).toBe(true);
    expect(await inSlot('JOBS', id)).toBe(false); // not assigned to Jobs

    // Pausing the placement (isActive:false) → stops rendering (placement eligibility fails).
    await patch(admin, `admin/marketing/placements/${placementId}`, { isActive: false });
    expect(await inSlot('MARKETPLACE', id)).toBe(false);
    await patch(admin, `admin/marketing/placements/${placementId}`, { isActive: true });
    expect(await inSlot('MARKETPLACE', id)).toBe(true);

    // Expired placement window → not rendered.
    await patch(admin, `admin/marketing/placements/${placementId}`, { endAt: '2020-01-01T00:00:00Z' });
    expect(await inSlot('MARKETPLACE', id)).toBe(false);
    await patch(admin, `admin/marketing/placements/${placementId}`, { endAt: null });
    expect(await inSlot('MARKETPLACE', id)).toBe(true);

    // Expired CAMPAIGN (promotion window) → not rendered even with an active placement (dual eligibility).
    await ctx.prisma.promotion.update({ where: { id }, data: { endAt: new Date('2020-01-01T00:00:00Z') } });
    expect(await inSlot('MARKETPLACE', id)).toBe(false);
    await ctx.prisma.promotion.update({ where: { id }, data: { endAt: null } });

    // Device rules: MOBILE-only placement is not served to DESKTOP.
    await patch(admin, `admin/marketing/placements/${placementId}`, { device: 'MOBILE' });
    expect(await inSlot('MARKETPLACE', id, '?device=DESKTOP')).toBe(false);
    expect(await inSlot('MARKETPLACE', id, '?device=MOBILE')).toBe(true);
    await patch(admin, `admin/marketing/placements/${placementId}`, { device: 'BOTH' });

    // Removing the placement removes the ad from the slot WITHOUT deleting the campaign.
    expect((await del(admin, `admin/marketing/placements/${placementId}`)).status).toBe(200);
    expect(await inSlot('MARKETPLACE', id)).toBe(false);
    expect((await get(admin, `admin/marketing/promotions/${id}`)).status).toBe(200); // campaign still exists
  });

  it('rejects placing an UNAPPROVED campaign, and Admin priority controls ordering within a slot', async () => {
    const biz = await makeVendor();
    // an unapproved (DRAFT) promotion cannot be placed
    const draft = await post(biz.cookies, 'business/marketing/promotions', { type: 'HOMEPAGE_BANNER', title: 'Draft ad', targets: [{ targetType: 'NONE' }] });
    expect((await post(admin, `admin/marketing/promotions/${draft.body.id}/placements`, { placement: 'SEARCH' })).status).toBe(400);

    // two approved+placed campaigns: higher Admin priority sorts first
    const low = await approvedCampaign(biz, 1);
    const high = await approvedCampaign(biz, 100);
    await post(admin, `admin/marketing/promotions/${low}/placements`, { placement: 'SEARCH' });
    await post(admin, `admin/marketing/promotions/${high}/placements`, { placement: 'SEARCH' });
    const ids = (await guest('marketing/placements/SEARCH')).body.map((p: { id: string }) => p.id).filter((x: string) => [low, high].includes(x));
    expect(ids).toEqual([high, low]);

    // one campaign can hold multiple placements
    await post(admin, `admin/marketing/promotions/${high}/placements`, { placement: 'JOBS' });
    expect(await inSlot('JOBS', high)).toBe(true);
    expect(await inSlot('SEARCH', high)).toBe(true);

    // admin placement listing + gating
    expect((await get(admin, 'admin/marketing/placements')).status).toBe(200);
    expect((await get(biz.cookies, 'admin/marketing/placements')).status).toBe(403);
  });

  /**
   * MDF-503: the admin console used to post a free-typed
   * "Category ID" straight through with no existence check at all -- a
   * typo or a stale id would create a row that silently never rendered
   * anywhere, discoverable only by asking why an ad never showed up. The
   * admin UI now picks from the real category list instead of typing an
   * id; this proves the SAME eligibility is enforced here, server-side,
   * independent of what the UI sends.
   */
  it('a CATEGORY_PAGE placement requires a real, visible category -- and never breaks one already placed', async () => {
    const biz = await makeVendor();

    // No category at all on a placement that requires one.
    const noCategory = await approvedCampaign(biz);
    expect((await post(admin, `admin/marketing/promotions/${noCategory}/placements`, { placement: 'CATEGORY_PAGE' })).status).toBe(400);

    // A category id that does not exist.
    const bogus = await approvedCampaign(biz);
    expect(
      (await post(admin, `admin/marketing/promotions/${bogus}/placements`, { placement: 'CATEGORY_PAGE', categoryId: 'does-not-exist' })).status,
    ).toBe(400);

    // A real but hidden category cannot receive a NEW placement.
    const hiddenSlug = uniq();
    const hidden = await ctx.prisma.category.create({ data: { name: `Hidden ${hiddenSlug}`, slug: `hidden-${hiddenSlug}`, isVisible: false } });
    const hiddenCampaign = await approvedCampaign(biz);
    expect(
      (await post(admin, `admin/marketing/promotions/${hiddenCampaign}/placements`, { placement: 'CATEGORY_PAGE', categoryId: hidden.id })).status,
    ).toBe(400);

    // A real, visible category works, and the ad is scoped to exactly that category.
    const visibleSlug = uniq();
    const visible = await ctx.prisma.category.create({ data: { name: `Shown ${visibleSlug}`, slug: `shown-${visibleSlug}` } });
    const id = await approvedCampaign(biz);
    const assign = await post(admin, `admin/marketing/promotions/${id}/placements`, { placement: 'CATEGORY_PAGE', categoryId: visible.id });
    expect(assign.status).toBe(201);
    expect(await inSlot('CATEGORY_PAGE', id, `?categoryId=${visible.id}`)).toBe(true);
    expect(await inSlot('CATEGORY_PAGE', id, `?categoryId=${hidden.id}`)).toBe(false);

    // Hiding the category AFTER the fact never breaks the existing placement
    // -- only a NEW assignment is checked, not an edit of one that already exists.
    const toHideSlug = uniq();
    const toHide = await ctx.prisma.category.create({ data: { name: `WillHide ${toHideSlug}`, slug: `will-hide-${toHideSlug}` } });
    const stillGood = await approvedCampaign(biz);
    const placed = await post(admin, `admin/marketing/promotions/${stillGood}/placements`, { placement: 'CATEGORY_PAGE', categoryId: toHide.id });
    expect(placed.status).toBe(201);
    await ctx.prisma.category.update({ where: { id: toHide.id }, data: { isVisible: false } });
    // Re-submitting the same assignment (e.g. to change its position) updates in place.
    const reSubmit = await post(admin, `admin/marketing/promotions/${stillGood}/placements`, {
      placement: 'CATEGORY_PAGE',
      categoryId: toHide.id,
      position: 5,
    });
    expect(reSubmit.status).toBe(201);
    expect(reSubmit.body.position).toBe(5);
  });
});
