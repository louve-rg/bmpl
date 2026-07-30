/**
 * Products (Phase 2 · M4) — integration against real Postgres.
 * Vendor CRUD + lifecycle (draft→submit→approve→public), admin moderation with
 * audit + notification, public visibility rules, ownership isolation, storefront
 * featured products, and the authorization matrix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  bootApp,
  cookiesOf,
  resetDb,
  seedLimitedAdmin,
  seedRoles,
  seedSuperAdmin,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function makeApprovedVendor(email: string, businessName: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({
    data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
  });
  const created = await request(ctx.server)
    .post('/api/vendor/profile')
    .set('Cookie', cookies)
    .send({ businessName, contactEmail: email });
  const vpId = created.body.profile.id;
  const slug = created.body.profile.slug;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId, slug };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server)
    .post('/api/admin/categories')
    .set('Cookie', adminCookies)
    .send({ name: 'Electronics' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('product auto-publish + public visibility', () => {
  let vendor: Awaited<ReturnType<typeof makeApprovedVendor>>;
  let productId: string;
  let productSlug: string;

  it('creates a product that is PUBLISHED immediately (no review step)', async () => {
    vendor = await makeApprovedVendor('p_vendor@example.bz', 'Gadget Hub');
    const res = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Wireless Earbuds', sku: 'WE-001', categoryId, priceMinor: 5999, salePriceMinor: 4999, featured: true, tags: ['audio', 'wireless'] });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('wireless-earbuds');
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.priceMinor).toBe(5999);
    productId = res.body.id;
    productSlug = res.body.slug;

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'PRODUCT_CREATED' } });
    expect(audit).toBeTruthy();
  });

  it('is immediately public — appears in the catalog + detail (no approval needed)', async () => {
    const list = await request(ctx.server).get('/api/marketplace/products');
    expect(list.body.items.some((p: { slug: string }) => p.slug === productSlug)).toBe(true);
    const detail = await request(ctx.server).get(`/api/marketplace/products/${productSlug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.title).toBe('Wireless Earbuds');
    expect(detail.body.tags).toEqual(expect.arrayContaining(['audio', 'wireless']));
  });

  it('rejects a duplicate SKU and a sale price above price', async () => {
    await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Dup', sku: 'WE-001', categoryId, priceMinor: 100 })
      .expect(409);
    await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Bad', sku: 'WE-002', categoryId, priceMinor: 100, salePriceMinor: 200 })
      .expect(400);
  });

  it('shows on the vendor storefront (featured) with its category', async () => {
    const store = await request(ctx.server).get(`/api/marketplace/vendors/${vendor.slug}`);
    expect(store.body.featuredProducts.some((p: { slug: string }) => p.slug === productSlug)).toBe(true);
    expect(store.body.categories.map((c: { name: string }) => c.name)).toContain('Electronics');
  });

  it('filters public list by category and vendor', async () => {
    const byCat = await request(ctx.server).get(`/api/marketplace/products?categoryId=${categoryId}`);
    expect(byCat.body.items.length).toBeGreaterThanOrEqual(1);
    const byVendor = await request(ctx.server).get(`/api/marketplace/products?vendorSlug=${vendor.slug}`);
    expect(byVendor.body.items.every((p: { vendor: { slug: string } }) => p.vendor.slug === vendor.slug)).toBe(true);
  });

  it('archiving hides it; re-publishing brings it back', async () => {
    await request(ctx.server).post(`/api/vendor/products/${productId}/archive`).set('Cookie', vendor.cookies).expect(201);
    await request(ctx.server).get(`/api/marketplace/products/${productSlug}`).expect(404);
    const back = await request(ctx.server).post(`/api/vendor/products/${productId}/unarchive`).set('Cookie', vendor.cookies);
    expect(back.status).toBe(201);
    expect(back.body.status).toBe('PUBLISHED');
    await request(ctx.server).get(`/api/marketplace/products/${productSlug}`).expect(200);
  });

  it('admin can suspend then restore a live product', async () => {
    await request(ctx.server).post(`/api/admin/products/${productId}/suspend`).set('Cookie', adminCookies).send({ note: 'Policy check' }).expect(201);
    await request(ctx.server).get(`/api/marketplace/products/${productSlug}`).expect(404);
    await request(ctx.server).post(`/api/admin/products/${productId}/restore`).set('Cookie', adminCookies).send({}).expect(201);
    await request(ctx.server).get(`/api/marketplace/products/${productSlug}`).expect(200);
  });

  it('hides all products when the vendor is suspended', async () => {
    const vp = await ctx.prisma.vendorProfile.findFirstOrThrow({ where: { slug: vendor.slug } });
    await request(ctx.server).post(`/api/admin/vendors/${vp.id}/suspend`).set('Cookie', adminCookies).send({ note: 'x' }).expect(201);
    const list = await request(ctx.server).get('/api/marketplace/products');
    expect(list.body.items.every((p: { slug: string }) => p.slug !== productSlug)).toBe(true);
    await request(ctx.server).post(`/api/admin/vendors/${vp.id}/restore`).set('Cookie', adminCookies).send({}).expect(201);
  });
});

describe('ownership, deletion, authorization', () => {
  let a: Awaited<ReturnType<typeof makeApprovedVendor>>;
  let b: Awaited<ReturnType<typeof makeApprovedVendor>>;
  let aProductId: string;

  beforeAll(async () => {
    a = await makeApprovedVendor('p_a@example.bz', 'Alpha Store');
    b = await makeApprovedVendor('p_b@example.bz', 'Beta Store');
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', a.cookies)
      .send({ title: 'Alpha Widget', sku: 'AW-1', categoryId, priceMinor: 1000 });
    aProductId = p.body.id;
  });

  it("forbids vendor B from reading or editing vendor A's product", async () => {
    await request(ctx.server).get(`/api/vendor/products/${aProductId}`).set('Cookie', b.cookies).expect(404);
    await request(ctx.server).patch(`/api/vendor/products/${aProductId}`).set('Cookie', b.cookies).send({ title: 'Hijack' }).expect(404);
  });

  it('lets the owner delete a live product', async () => {
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', a.cookies)
      .send({ title: 'Scratch', sku: 'SC-1', categoryId, priceMinor: 50 });
    expect(p.body.status).toBe('PUBLISHED');
    await request(ctx.server).delete(`/api/vendor/products/${p.body.id}`).set('Cookie', a.cookies).expect(200);
  });

  it('refuses to delete an admin-suspended product', async () => {
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', a.cookies)
      .send({ title: 'Suspendable', sku: 'SU-1', categoryId, priceMinor: 200 });
    await request(ctx.server).post(`/api/admin/products/${p.body.id}/suspend`).set('Cookie', adminCookies).send({ note: 'hold' }).expect(201);
    await request(ctx.server).delete(`/api/vendor/products/${p.body.id}`).set('Cookie', a.cookies).expect(409);
  });

  it('enforces the authorization matrix', async () => {
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'p_customer@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    const customer = cookiesOf(reg);
    await request(ctx.server).get('/api/vendor/products').set('Cookie', customer).expect(403);
    await request(ctx.server).get('/api/vendor/products').expect(401);

    const limited = await seedLimitedAdmin(ctx.prisma, 'p_limited@example.bz', ['products.read']);
    const lc = await login(limited.email, limited.password);
    await request(ctx.server).get('/api/admin/products').set('Cookie', lc).expect(200);
    await request(ctx.server).post(`/api/admin/products/${aProductId}/suspend`).set('Cookie', lc).send({}).expect(403);
  });
});
