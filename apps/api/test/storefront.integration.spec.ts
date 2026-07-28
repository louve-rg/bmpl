/**
 * Public vendor storefront (Phase 2 · M3) — integration against real Postgres.
 * Verifies that only APPROVED (non-vacation) vendors are exposed publicly and
 * that unknown / unapproved slugs 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];

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
  const id = created.body.profile.id;
  const slug = created.body.profile.slug;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${id}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, id, slug };
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

describe('public storefront visibility', () => {
  let approved: { cookies: string[]; id: string; slug: string };

  it('lists approved vendors and exposes the storefront (no auth)', async () => {
    approved = await makeApprovedVendor('sf_ok@example.bz', 'Sunrise Grocery');

    // A draft vendor that must never appear publicly.
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'sf_draft@example.bz', password: 'VendorPass123', firstName: 'D', lastName: 'R', acceptedTerms: true });
    const draftCookies = cookiesOf(reg);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'sf_draft@example.bz' } });
    await ctx.prisma.userRole.create({ data: { userId: u.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
    const draft = await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', draftCookies)
      .send({ businessName: 'Hidden Draft Shop', contactEmail: 'sf_draft@example.bz' });

    const list = await request(ctx.server).get('/api/marketplace/vendors');
    expect(list.status).toBe(200);
    const names = list.body.map((v: { businessName: string }) => v.businessName);
    expect(names).toContain('Sunrise Grocery');
    expect(names).not.toContain('Hidden Draft Shop');

    // Draft storefront is 404 even by its exact slug.
    await request(ctx.server).get(`/api/marketplace/vendors/${draft.body.profile.slug}`).expect(404);
  });

  it('returns the storefront detail by slug', async () => {
    const res = await request(ctx.server).get(`/api/marketplace/vendors/${approved.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe('Sunrise Grocery');
    expect(res.body).toHaveProperty('openingHours');
    expect(res.body).toHaveProperty('locations');
    expect(res.body.featuredProducts).toEqual([]); // populated in M4
  });

  it('404s for an unknown slug', async () => {
    await request(ctx.server).get('/api/marketplace/vendors/does-not-exist').expect(404);
  });

  it('hides vacation-mode vendors from the directory but keeps the storefront reachable', async () => {
    await request(ctx.server)
      .patch('/api/vendor/settings')
      .set('Cookie', approved.cookies)
      .send({ vacationMode: true })
      .expect(200);

    const list = await request(ctx.server).get('/api/marketplace/vendors');
    expect(list.body.some((v: { slug: string }) => v.slug === approved.slug)).toBe(false);

    const detail = await request(ctx.server).get(`/api/marketplace/vendors/${approved.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.vacationMode).toBe(true);
  });
});
