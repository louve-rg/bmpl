/**
 * Marketplace browse/search (Phase 2 · M7) — integration against real Postgres.
 * PostgreSQL full-text search, category-subtree filter, price/featured/in-stock
 * filters, sorting, pagination, and vendor directory search.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

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
  await request(ctx.server).post(`/api/vendor/products/${id}/submit`).set('Cookie', vendorCookies).expect(201);
  await request(ctx.server).post(`/api/admin/products/${id}/approve`).set('Cookie', adminCookies).send({}).expect(201);
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
