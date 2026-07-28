/**
 * Marketplace categories (Phase 2 · M1) — integration against real PostgreSQL.
 * Covers admin CRUD, hierarchy rules (no-cycle, delete-with-children), slug
 * uniqueness, public visibility, audit trail, and the authorization matrix.
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
let customerCookies: string[];

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function createCategory(cookies: string[], body: Record<string, unknown>) {
  return request(ctx.server).post('/api/admin/categories').set('Cookie', cookies).send(body);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('admin category CRUD + hierarchy', () => {
  let electronicsId: string;
  let phonesId: string;

  it('creates a root category and derives a slug from the name', async () => {
    const res = await createCategory(adminCookies, { name: 'Electronics' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('electronics');
    expect(res.body.parentId).toBeNull();
    expect(res.body.isVisible).toBe(true);
    electronicsId = res.body.id;

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'CATEGORY_CREATED' } });
    expect(audit).toBeTruthy();
  });

  it('suffixes the slug on a derived collision', async () => {
    const res = await createCategory(adminCookies, { name: 'Electronics' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('electronics-2');
  });

  it('rejects an explicit duplicate slug with 409', async () => {
    const res = await createCategory(adminCookies, { name: 'Gadgets', slug: 'electronics' });
    expect(res.status).toBe(409);
  });

  it('creates a child under an existing parent', async () => {
    const res = await createCategory(adminCookies, { name: 'Phones', parentId: electronicsId });
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(electronicsId);
    phonesId = res.body.id;
  });

  it('rejects a child under a non-existent parent', async () => {
    const res = await createCategory(adminCookies, { name: 'Orphan', parentId: 'clzzzzzzzzzzzzzzzzzzzzzzzz' });
    expect(res.status).toBe(404);
  });

  it('updates a category and records an audit entry', async () => {
    const res = await request(ctx.server)
      .patch(`/api/admin/categories/${phonesId}`)
      .set('Cookie', adminCookies)
      .send({ featured: true, sortOrder: 5 });
    expect(res.status).toBe(200);
    expect(res.body.featured).toBe(true);
    expect(res.body.sortOrder).toBe(5);

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'CATEGORY_UPDATED' } });
    expect(audit).toBeTruthy();
  });

  it('refuses to make a category its own parent', async () => {
    const res = await request(ctx.server)
      .patch(`/api/admin/categories/${electronicsId}`)
      .set('Cookie', adminCookies)
      .send({ parentId: electronicsId });
    expect(res.status).toBe(400);
  });

  it('refuses a parent that would create a cycle (parent -> descendant)', async () => {
    // electronics -> phones already; setting electronics.parent = phones is a cycle.
    const res = await request(ctx.server)
      .patch(`/api/admin/categories/${electronicsId}`)
      .set('Cookie', adminCookies)
      .send({ parentId: phonesId });
    expect(res.status).toBe(400);
  });

  it('refuses to delete a category that still has children (409)', async () => {
    const res = await request(ctx.server)
      .delete(`/api/admin/categories/${electronicsId}`)
      .set('Cookie', adminCookies);
    expect(res.status).toBe(409);
  });

  it('deletes a leaf category and writes an audit entry', async () => {
    const res = await request(ctx.server)
      .delete(`/api/admin/categories/${phonesId}`)
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);

    const gone = await ctx.prisma.category.findUnique({ where: { id: phonesId } });
    expect(gone).toBeNull();
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'CATEGORY_DELETED' } });
    expect(audit).toBeTruthy();
  });
});

describe('public category tree + visibility', () => {
  it('returns only visible categories and hides a hidden parent subtree', async () => {
    await resetDb(ctx.prisma);
    await seedRoles(ctx.prisma);
    const admin = await seedSuperAdmin(ctx.prisma);
    adminCookies = await login(admin.email, admin.password);

    const home = await createCategory(adminCookies, { name: 'Home', sortOrder: 1 });
    const garden = await createCategory(adminCookies, { name: 'Garden', parentId: home.body.id });
    const hidden = await createCategory(adminCookies, { name: 'Secret', sortOrder: 2, isVisible: false });
    await createCategory(adminCookies, { name: 'SecretChild', parentId: hidden.body.id });
    expect(garden.status).toBe(201);

    const res = await request(ctx.server).get('/api/marketplace/categories'); // no auth
    expect(res.status).toBe(200);
    const names = res.body.map((c: { name: string }) => c.name);
    expect(names).toContain('Home');
    expect(names).not.toContain('Secret'); // hidden root omitted
    const homeNode = res.body.find((c: { name: string }) => c.name === 'Home');
    expect(homeNode.children.map((c: { name: string }) => c.name)).toEqual(['Garden']);
    // The visible child of a hidden parent must not surface anywhere.
    const flat = JSON.stringify(res.body);
    expect(flat).not.toContain('SecretChild');
  });
});

describe('authorization matrix', () => {
  // Prior describes reset the DB; establish a fresh admin + customer so cookies
  // reference live sessions (a wiped user would 401 instead of the 403 we assert).
  beforeAll(async () => {
    await resetDb(ctx.prisma);
    await seedRoles(ctx.prisma);
    const admin = await seedSuperAdmin(ctx.prisma);
    adminCookies = await login(admin.email, admin.password);
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'cat_customer@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    expect(reg.status).toBe(201);
    customerCookies = cookiesOf(reg);
  });

  it('allows the public tree without authentication', async () => {
    await request(ctx.server).get('/api/marketplace/categories').expect(200);
  });

  it('forbids a customer from listing or mutating categories', async () => {
    await request(ctx.server).get('/api/admin/categories').set('Cookie', customerCookies).expect(403);
    await createCategory(customerCookies, { name: 'Nope' }).then((r) => expect(r.status).toBe(403));
  });

  it('forbids an admin WITHOUT categories.manage', async () => {
    const limited = await seedLimitedAdmin(ctx.prisma, 'cat_limited@example.bz', ['users.read']);
    const limitedCookies = await login(limited.email, limited.password);
    await request(ctx.server).get('/api/admin/categories').set('Cookie', limitedCookies).expect(403);
    await createCategory(limitedCookies, { name: 'Nope' }).then((r) => expect(r.status).toBe(403));
  });

  it('rejects an unauthenticated mutation', async () => {
    await request(ctx.server).post('/api/admin/categories').send({ name: 'Nope' }).expect(401);
  });
});
