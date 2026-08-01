/**
 * Saved Products (Wishlists) & Recently Viewed (Phase 4 · M20) — integration vs
 * real Postgres. Own-account scoping, idempotent save, viewability gating (404 for
 * non-published), graceful "no longer available" for unpublished-after-save,
 * cross-user isolation, recently-viewed ordering + newest-N cap + clear, and the
 * no-money/no-inventory invariant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { RECENTLY_VIEWED_MAX } from '@bmpl/shared';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let vendorProfileId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send({});
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

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
async function makeProduct(status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
  const s = uniq();
  const p = await ctx.prisma.product.create({
    data: { vendorProfileId, categoryId, title: `Item ${s}`, slug: `item-${s}`, sku: `SKU-${s}`, status, priceMinor: 2500n, currency: 'BZD' },
  });
  return p.id;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `Cat ${uniq()}` })).body.id;
  const s = uniq();
  const vend = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: vend.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  vendorProfileId = (await ctx.prisma.vendorProfile.create({ data: { userId: vend.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } })).id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('saved products (wishlist)', () => {
  it('saves (idempotent), lists with a card, exposes ids + count, and unsaves', async () => {
    const c = (await register(`w1_${uniq()}@example.bz`)).cookies;
    const productId = await makeProduct();

    expect((await post(c, `saved/${productId}`)).body).toEqual({ saved: true });
    expect((await post(c, `saved/${productId}`)).body).toEqual({ saved: true }); // idempotent

    const list = await get(c, 'saved');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ productId, available: true });
    expect(list.body.items[0].product).toMatchObject({ id: productId, priceMinor: 2500 });
    expect(list.body.items[0].product).toHaveProperty('ratingAverage'); // card carries M19 aggregate

    expect((await get(c, 'saved/ids')).body.productIds).toEqual([productId]);
    expect((await get(c, 'saved/count')).body.count).toBe(1);

    expect((await del(c, `saved/${productId}`)).body).toEqual({ saved: false });
    expect((await del(c, `saved/${productId}`)).status).toBe(200); // idempotent unsave
    expect((await get(c, 'saved/count')).body.count).toBe(0);
  });

  it('rejects saving a non-viewable product (404) and never moves inventory', async () => {
    const c = (await register(`w2_${uniq()}@example.bz`)).cookies;
    const draftId = await makeProduct('DRAFT');
    expect((await post(c, `saved/${draftId}`)).status).toBe(404);
    expect((await post(c, `saved/nonexistent-id`)).status).toBe(404);
    // no inventory rows were created/changed by saving
    expect(await ctx.prisma.inventory.count({ where: { productId: draftId } })).toBe(0);
  });

  it('keeps the saved row but reports available:false once the product is unpublished', async () => {
    const c = (await register(`w3_${uniq()}@example.bz`)).cookies;
    const productId = await makeProduct();
    await post(c, `saved/${productId}`);
    await ctx.prisma.product.update({ where: { id: productId }, data: { status: 'SUSPENDED' } });
    const list = await get(c, 'saved');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ productId, available: false, product: null });
    // re-publish → it becomes available again (row was preserved)
    await ctx.prisma.product.update({ where: { id: productId }, data: { status: 'PUBLISHED' } });
    expect((await get(c, 'saved')).body.items[0].available).toBe(true);
  });

  it('isolates wishlists across users and requires auth', async () => {
    const a = (await register(`w4a_${uniq()}@example.bz`)).cookies;
    const b = (await register(`w4b_${uniq()}@example.bz`)).cookies;
    const productId = await makeProduct();
    await post(a, `saved/${productId}`);
    expect((await get(a, 'saved/count')).body.count).toBe(1);
    expect((await get(b, 'saved/count')).body.count).toBe(0); // B cannot see A's wishlist
    // guest
    expect((await request(ctx.server).get('/api/saved')).status).toBe(401);
    expect((await request(ctx.server).post(`/api/saved/${productId}`)).status).toBe(401);
  });
});

describe('recently viewed', () => {
  it('records views most-recent-first, updates order on re-view, and clears', async () => {
    const c = (await register(`rv1_${uniq()}@example.bz`)).cookies;
    const p1 = await makeProduct();
    const p2 = await makeProduct();
    expect((await post(c, `recently-viewed/${p1}`)).body).toEqual({ ok: true });
    expect((await post(c, `recently-viewed/${p2}`)).body).toEqual({ ok: true });
    let list = await get(c, 'recently-viewed');
    expect(list.body.items.map((i: { productId: string }) => i.productId)).toEqual([p2, p1]);
    // re-viewing p1 moves it to the front (still one row, not duplicated)
    await post(c, `recently-viewed/${p1}`);
    list = await get(c, 'recently-viewed');
    expect(list.body.items.map((i: { productId: string }) => i.productId)).toEqual([p1, p2]);
    expect(list.body.items[0]).toMatchObject({ available: true });
    // clear (privacy control)
    expect((await del(c, 'recently-viewed')).body).toEqual({ ok: true });
    expect((await get(c, 'recently-viewed')).body.items).toHaveLength(0);
  });

  it('caps the history to the newest RECENTLY_VIEWED_MAX and rejects non-viewable', async () => {
    const reg = await register(`rv2_${uniq()}@example.bz`);
    const c = reg.cookies;
    // View MAX+1 distinct products; the very first one viewed must be pruned.
    const first = await makeProduct();
    await post(c, `recently-viewed/${first}`);
    for (let i = 0; i < RECENTLY_VIEWED_MAX; i += 1) {
      const id = await makeProduct();
      await post(c, `recently-viewed/${id}`);
    }
    const total = await ctx.prisma.recentlyViewedProduct.count({ where: { userId: reg.userId } });
    expect(total).toBe(RECENTLY_VIEWED_MAX); // pruned to the cap
    expect(await ctx.prisma.recentlyViewedProduct.findFirst({ where: { userId: reg.userId, productId: first } })).toBeNull();
    // non-viewable view → 404
    const draftId = await makeProduct('DRAFT');
    expect((await post(c, `recently-viewed/${draftId}`)).status).toBe(404);
  });

  it('keeps recently-viewed private per user and requires auth', async () => {
    const a = (await register(`rv3a_${uniq()}@example.bz`)).cookies;
    const b = (await register(`rv3b_${uniq()}@example.bz`)).cookies;
    const productId = await makeProduct();
    await post(a, `recently-viewed/${productId}`);
    expect((await get(b, 'recently-viewed')).body.items).toHaveLength(0);
    expect((await request(ctx.server).get('/api/recently-viewed')).status).toBe(401);
  });
});
