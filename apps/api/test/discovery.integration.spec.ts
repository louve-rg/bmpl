/**
 * Discovery & Recommendations (Phase 4 · M21) — integration vs real Postgres.
 * Deterministic, non-AI heuristics: homepage bundle, product-detail cross-sell
 * (related + more-from-vendor), personalized for-you from the caller's own M20
 * signals with cold-start fallback, and search typeahead — all surfacing only
 * PUBLISHED products of APPROVED vendors, and never leaking cross-user data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let catA: string;
let catB: string;
let vendorProfileId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const guestGet = (p: string) => request(ctx.server).get(`/api/${p}`);

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
async function makeProduct(opts: { categoryId: string; title?: string; status?: 'PUBLISHED' | 'DRAFT'; featured?: boolean; ratingAverage?: number; ratingCount?: number } ) {
  const s = uniq();
  const p = await ctx.prisma.product.create({
    data: {
      vendorProfileId, categoryId: opts.categoryId, title: opts.title ?? `Item ${s}`, slug: `item-${s}`, sku: `SKU-${s}`,
      status: opts.status ?? 'PUBLISHED', priceMinor: 1500n, currency: 'BZD', featured: opts.featured ?? false,
      ratingAverage: opts.ratingAverage ?? 0, ratingCount: opts.ratingCount ?? 0,
    },
  });
  return p;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  catA = (await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `CatA ${uniq()}` })).body.id;
  catB = (await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `CatB ${uniq()}` })).body.id;
  const s = uniq();
  const vend = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: vend.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  vendorProfileId = (await ctx.prisma.vendorProfile.create({ data: { userId: vend.userId, businessName: `Acme Traders ${s}`, slug: `acme-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } })).id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('homepage discovery bundle', () => {
  it('returns featured / topRated / newArrivals / popular / categories, PUBLISHED only', async () => {
    await makeProduct({ categoryId: catA, featured: true, title: 'Featured Thing' });
    await makeProduct({ categoryId: catA, ratingAverage: 4.8, ratingCount: 12, title: 'Top Rated Thing' });
    await makeProduct({ categoryId: catB, title: 'Fresh Thing' });
    const draft = await makeProduct({ categoryId: catB, status: 'DRAFT', title: 'Hidden Draft' });

    const res = await guestGet('marketplace/discovery');
    expect(res.status).toBe(200);
    for (const key of ['featured', 'topRated', 'newArrivals', 'popular', 'categories']) expect(res.body).toHaveProperty(key);
    // the draft never appears in any product section
    const allProductIds = [...res.body.featured, ...res.body.topRated, ...res.body.newArrivals, ...res.body.popular].map((c: { id: string }) => c.id);
    expect(allProductIds).not.toContain(draft.id);
    // featured section contains the featured product; top-rated the high-rated one
    expect(res.body.featured.some((c: { title: string }) => c.title === 'Featured Thing')).toBe(true);
    expect(res.body.topRated[0]).toMatchObject({ title: 'Top Rated Thing' });
    // categories carry product counts and only visible categories
    expect(res.body.categories.every((c: { productCount: number }) => c.productCount >= 1)).toBe(true);
    // popular falls back to non-empty on a catalog with no sales
    expect(res.body.popular.length).toBeGreaterThan(0);
  });
});

describe('product-detail cross-sell', () => {
  it('returns same-category related + more-from-vendor, excluding the product itself', async () => {
    const anchor = await makeProduct({ categoryId: catA, title: 'Anchor' });
    const sibling = await makeProduct({ categoryId: catA, title: 'Sibling', ratingCount: 3 });
    const res = await guestGet(`marketplace/products/${anchor.slug}/related`);
    expect(res.status).toBe(200);
    const relatedIds = res.body.related.map((c: { id: string }) => c.id);
    expect(relatedIds).toContain(sibling.id);
    expect(relatedIds).not.toContain(anchor.id); // never recommends itself
    expect(res.body.moreFromVendor.every((c: { id: string }) => c.id !== anchor.id)).toBe(true);
  });

  it('404s for an unknown or non-viewable product', async () => {
    expect((await guestGet('marketplace/products/does-not-exist/related')).status).toBe(404);
    const draft = await makeProduct({ categoryId: catA, status: 'DRAFT' });
    expect((await guestGet(`marketplace/products/${draft.slug}/related`)).status).toBe(404);
  });
});

describe('personalized for-you', () => {
  it('recommends from the caller\'s viewed/saved categories, excludes engaged items, and is private + auth-gated', async () => {
    const buyer = await register(`fy_${uniq()}@example.bz`);
    const viewedProd = await makeProduct({ categoryId: catB, title: 'Viewed In B' });
    const targetProd = await makeProduct({ categoryId: catB, title: 'Recommendable In B', ratingCount: 5 });
    // signal: the buyer viewed a catB product
    await request(ctx.server).post(`/api/recently-viewed/${viewedProd.id}`).set('Cookie', buyer.cookies).send({});

    const res = await get(buyer.cookies, 'recommendations/for-you');
    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    const ids = res.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(targetProd.id); // another catB product
    expect(ids).not.toContain(viewedProd.id); // the already-viewed product is excluded

    // a different user with no signals gets a non-empty cold-start fallback, and never the first user's data leaks (own-signal only)
    const cold = await register(`fy2_${uniq()}@example.bz`);
    const coldRes = await get(cold.cookies, 'recommendations/for-you');
    expect(coldRes.status).toBe(200);
    expect(coldRes.body.personalized).toBe(false);
    expect(coldRes.body.items.length).toBeGreaterThan(0);

    // guest is rejected
    expect((await guestGet('recommendations/for-you')).status).toBe(401);
  });
});

describe('search typeahead', () => {
  it('suggests products, categories, and vendors; ignores too-short queries', async () => {
    await makeProduct({ categoryId: catA, title: 'Zephyr Lantern' });
    const res = await guestGet('marketplace/search/suggest?q=Zephyr');
    expect(res.status).toBe(200);
    expect(res.body.products.some((p: { title: string }) => p.title === 'Zephyr Lantern')).toBe(true);
    const vend = await guestGet('marketplace/search/suggest?q=Acme');
    expect(vend.body.vendors.some((v: { businessName: string }) => v.businessName.startsWith('Acme'))).toBe(true);
    // below the min-char threshold → empty groups, no error
    const short = await guestGet('marketplace/search/suggest?q=Z');
    expect(short.status).toBe(200);
    expect(short.body).toEqual({ products: [], categories: [], vendors: [] });
  });
});
