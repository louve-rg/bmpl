/**
 * Owner storefront preview (Phase 2 storefront) — integration vs real Postgres.
 * A vendor can preview their OWN storefront in any status (before it is public);
 * others cannot; and the public storefront stays gated on approval.
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
async function makeVendor(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  return cookiesOf(reg);
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

describe('owner storefront preview', () => {
  let vendorCookies: string[];
  let slug: string;
  let profileId: string;

  it('previews an unapproved (DRAFT) storefront while it is NOT public', async () => {
    vendorCookies = await makeVendor('preview_v@example.bz');
    const created = await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', vendorCookies)
      .send({ businessName: 'Preview Store', contactEmail: 'preview_v@example.bz' });
    expect(created.status).toBe(201);
    slug = created.body.profile.slug;
    profileId = created.body.profile.id;

    const preview = await request(ctx.server).get('/api/vendor/profile/preview').set('Cookie', vendorCookies);
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.approvalStatus).toBe('DRAFT');
    expect(preview.body.businessName).toBe('Preview Store');
    expect(preview.body).toHaveProperty('featuredProducts');
    expect(preview.body).toHaveProperty('openingHours');

    // Not publicly visible yet.
    await request(ctx.server).get(`/api/marketplace/vendors/${slug}`).expect(404);
  });

  it('still previews after submit (PENDING), and goes public once approved', async () => {
    await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', vendorCookies).expect(201);
    let preview = await request(ctx.server).get('/api/vendor/profile/preview').set('Cookie', vendorCookies);
    expect(preview.body.approvalStatus).toBe('PENDING');
    await request(ctx.server).get(`/api/marketplace/vendors/${slug}`).expect(404); // still not public

    await request(ctx.server).post(`/api/admin/vendors/${profileId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
    await request(ctx.server).get(`/api/marketplace/vendors/${slug}`).expect(200); // now public
    preview = await request(ctx.server).get('/api/vendor/profile/preview').set('Cookie', vendorCookies);
    expect(preview.body.approvalStatus).toBe('APPROVED');
  });

  it('404s preview for a vendor with no storefront yet', async () => {
    const other = await makeVendor('preview_none@example.bz');
    await request(ctx.server).get('/api/vendor/profile/preview').set('Cookie', other).expect(404);
  });

  it('forbids a customer and unauthenticated access', async () => {
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'preview_cust@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    await request(ctx.server).get('/api/vendor/profile/preview').set('Cookie', cookiesOf(reg)).expect(403);
    await request(ctx.server).get('/api/vendor/profile/preview').expect(401);
  });
});
