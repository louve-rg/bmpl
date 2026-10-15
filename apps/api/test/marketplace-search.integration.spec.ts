/**
 * Marketplace browse/search (Phase 2 · M7) — integration against real Postgres.
 * PostgreSQL full-text search, category-subtree filter, price/featured/in-stock
 * filters, sorting, pagination, and vendor directory search.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

/** Adds a single-value option to a product and returns that value's id. */
async function addSingleOptionValue(server: TestContext['server'], cookies: string[], productId: string, name: string, value: string): Promise<string> {
  await request(server).post(`/api/vendor/products/${productId}/options`).set('Cookie', cookies).send({ name, values: [value] }).expect(201);
  const view = await request(server).get(`/api/vendor/products/${productId}/variants`).set('Cookie', cookies);
  const option = view.body.options.find((o: { name: string }) => o.name === name);
  return option.values[0].id as string;
}

let ctx: TestContext;
let adminCookies: string[];
let vendorCookies: string[];
let electronicsId: string;
let audioId: string;
let apparelId: string;

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function publishProduct(fields: Record<string, unknown>, opts?: { stockZero?: boolean }) {
  const create = await request(ctx.server).post('/api/vendor/products').set('Cookie', vendorCookies).send(fields);
  expect(create.status).toBe(201);
  const id = create.body.id;
  if (opts?.stockZero) {
    // touch inventory so it is tracked at 0 (out of stock)
    await request(ctx.server).get(`/api/vendor/products/${id}/inventory`).set('Cookie', vendorCookies).expect(200);
  }
  // products are PUBLISHED on create (auto-publish); vendor approved above.
  return id;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);

  const elec = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Electronics' });
  electronicsId = elec.body.id;
  const audio = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Audio', parentId: electronicsId });
  audioId = audio.body.id;
  const apparel = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Apparel' });
  apparelId = apparel.body.id;

  // approved vendor
  const reg = await request(ctx.server).post('/api/auth/register').send({ email: 'search_v@example.bz', password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  vendorCookies = cookiesOf(reg);
  const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'search_v@example.bz' } });
  await ctx.prisma.userRole.create({ data: { userId: u.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await request(ctx.server).post('/api/vendor/profile').set('Cookie', vendorCookies).send({ businessName: 'Gadget Hub', contactEmail: 'search_v@example.bz' });
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', vendorCookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${profile.body.profile.id}/approve`).set('Cookie', adminCookies).send({}).expect(201);

  await publishProduct({ title: 'Wireless Earbuds', sku: 'WE', categoryId: audioId, priceMinor: 5000, featured: true, brand: 'Sony', searchKeywords: ['headphones'] });
  await publishProduct({ title: 'Bluetooth Speaker', sku: 'BS', categoryId: audioId, priceMinor: 8000, description: 'Portable earbuds-free audio' });
  await publishProduct({ title: 'Cotton T-Shirt', sku: 'TS', categoryId: apparelId, priceMinor: 2000 });
  await publishProduct({ title: 'Running Shoes', sku: 'RS', categoryId: apparelId, priceMinor: 12000 }, { stockZero: true });
});
afterAll(async () => {
  await ctx.app.close();
});

const titles = (body: { items: Array<{ title: string }> }) => body.items.map((i) => i.title);

describe('full-text search', () => {
  it('matches on title/keywords/description', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?q=earbuds');
    expect(res.status).toBe(200);
    const found = titles(res.body);
    expect(found).toContain('Wireless Earbuds');
    // "earbuds" also appears in the speaker description
    expect(found).toContain('Bluetooth Speaker');
    expect(found).not.toContain('Cotton T-Shirt');
  });

  it('ranks by relevance when sorted by relevance', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?q=earbuds&sort=relevance');
    // title match (weight A) should outrank a description match
    expect(res.body.items[0].title).toBe('Wireless Earbuds');
  });
});

describe('filters', () => {
  it('filters by category subtree (parent includes child products)', async () => {
    const res = await request(ctx.server).get(`/api/marketplace/products?categoryId=${electronicsId}`);
    const found = titles(res.body).sort();
    expect(found).toEqual(['Bluetooth Speaker', 'Wireless Earbuds']);
  });

  it('filters by price range', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?priceMin=3000&priceMax=9000');
    expect(titles(res.body).sort()).toEqual(['Bluetooth Speaker', 'Wireless Earbuds']);
  });

  it('filters by featured', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?featured=true');
    expect(titles(res.body)).toEqual(['Wireless Earbuds']);
  });

  it('filters out-of-stock when inStock=true', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?inStock=true');
    expect(titles(res.body)).not.toContain('Running Shoes'); // tracked at 0
    expect(titles(res.body)).toContain('Cotton T-Shirt'); // untracked = available
  });
});

describe('sort + pagination', () => {
  it('sorts by price ascending', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?sort=price_asc');
    const prices = res.body.items.map((i: { priceMinor: number }) => i.priceMinor);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('paginates with a correct total', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products?pageSize=2&page=1');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(4);
    const page2 = await request(ctx.server).get('/api/marketplace/products?pageSize=2&page=2');
    expect(page2.body.items).toHaveLength(2);
  });
});

describe('vendor directory search', () => {
  it('searches vendors by name', async () => {
    const hit = await request(ctx.server).get('/api/marketplace/vendors?q=gadget');
    expect(hit.body.some((v: { slug: string }) => v.slug === 'gadget-hub')).toBe(true);
    const miss = await request(ctx.server).get('/api/marketplace/vendors?q=zzz-nothing');
    expect(miss.body).toHaveLength(0);
  });
});

/**
 * A `variantId IS NULL` inventory row is the REAL stock for a product with no
 * variants, but a dead orphan once the product has variants (generateVariants()
 * never reconciles it — see InventoryService.excludeOrphanProductRow). The
 * inStock/hideOutOfStock filters here run their own raw SQL outside that
 * service and must agree with it, or a product with zero real (variant) stock
 * reads as "in stock" in search even though InventoryService itself now knows
 * better (oversell-adjacent: a false availability signal, not a purchase hole
 * — checkout's own guard at orders.service.ts still blocks the actual buy).
 */
describe('orphan product-level row vs. the public inStock/hideOutOfStock filters', () => {
  it('a product whose real (variant) stock is zero does NOT appear under inStock=true just because a dead 17-unit orphan row is still sitting there', async () => {
    const id = await publishProduct({ title: 'Ghost Stock Jacket', sku: 'GSJ', categoryId: apparelId, priceMinor: 9000 });
    await request(ctx.server).post(`/api/vendor/products/${id}/inventory/adjust`).set('Cookie', vendorCookies).send({ delta: 17, reason: 'RESTOCK' }).expect(201);
    const valueId = await addSingleOptionValue(ctx.server, vendorCookies, id, 'Size', 'S');
    await request(ctx.server).post(`/api/vendor/products/${id}/variants`).set('Cookie', vendorCookies).send({ optionValueIds: [valueId], sku: 'GSJ-S', quantity: 0 }).expect(201);

    const res = await request(ctx.server).get('/api/marketplace/products?inStock=true');
    expect(titles(res.body)).not.toContain('Ghost Stock Jacket');
  });

  it('a product with NO variants still appears under inStock=true from its own real product-level row', async () => {
    const id = await publishProduct({ title: 'Plain Backpack', sku: 'PB', categoryId: apparelId, priceMinor: 7000 });
    await request(ctx.server).post(`/api/vendor/products/${id}/inventory/adjust`).set('Cookie', vendorCookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);

    const res = await request(ctx.server).get('/api/marketplace/products?inStock=true');
    expect(titles(res.body)).toContain('Plain Backpack');
  });

  it('a product WITH variants where a variant genuinely has stock still appears under inStock=true', async () => {
    const id = await publishProduct({ title: 'Real Stock Hoodie', sku: 'RSH', categoryId: apparelId, priceMinor: 11000 });
    const valueId = await addSingleOptionValue(ctx.server, vendorCookies, id, 'Size', 'M');
    await request(ctx.server).post(`/api/vendor/products/${id}/variants`).set('Cookie', vendorCookies).send({ optionValueIds: [valueId], sku: 'RSH-M', quantity: 3 }).expect(201);

    const res = await request(ctx.server).get('/api/marketplace/products?inStock=true');
    expect(titles(res.body)).toContain('Real Stock Hoodie');
  });

  it('hideOutOfStock: a product whose real (variant) stock is zero stays hidden despite the dead orphan row; one with real variant stock stays visible', async () => {
    const reg = await request(ctx.server).post('/api/auth/register').send({ email: 'oos_hide_v@example.bz', password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
    const cookies = cookiesOf(reg);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'oos_hide_v@example.bz' } });
    await ctx.prisma.userRole.create({ data: { userId: u.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
    const profile = await request(ctx.server).post('/api/vendor/profile').set('Cookie', cookies).send({ businessName: 'Hide OOS Co', contactEmail: 'oos_hide_v@example.bz' });
    await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
    await request(ctx.server).post(`/api/admin/vendors/${profile.body.profile.id}/approve`).set('Cookie', adminCookies).send({}).expect(201);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', cookies).send({ hideOutOfStock: true }).expect(200);

    const ghost = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ title: 'Hidden Ghost Shirt', sku: 'HGS', categoryId: apparelId, priceMinor: 4000 });
    const ghostId = ghost.body.id;
    await request(ctx.server).post(`/api/vendor/products/${ghostId}/inventory/adjust`).set('Cookie', cookies).send({ delta: 17, reason: 'RESTOCK' }).expect(201);
    const ghostValueId = await addSingleOptionValue(ctx.server, cookies, ghostId, 'Size', 'S');
    await request(ctx.server).post(`/api/vendor/products/${ghostId}/variants`).set('Cookie', cookies).send({ optionValueIds: [ghostValueId], sku: 'HGS-S', quantity: 0 }).expect(201);

    const real = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ title: 'Visible Real Shirt', sku: 'VRS', categoryId: apparelId, priceMinor: 4000 });
    const realId = real.body.id;
    const realValueId = await addSingleOptionValue(ctx.server, cookies, realId, 'Size', 'M');
    await request(ctx.server).post(`/api/vendor/products/${realId}/variants`).set('Cookie', cookies).send({ optionValueIds: [realValueId], sku: 'VRS-M', quantity: 2 }).expect(201);

    const res = await request(ctx.server).get('/api/marketplace/products');
    const found = titles(res.body);
    expect(found).not.toContain('Hidden Ghost Shirt');
    expect(found).toContain('Visible Real Shirt');
  });
});
