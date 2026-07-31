/**
 * Vendor business profiles (Phase 2 · M2) — integration against real Postgres + MinIO.
 * Covers owner CRUD, settings, locations, hours, submit-for-review, admin moderation
 * (approve/reject/suspend/restore) with audit + notification, logo upload round-trip,
 * ownership isolation, and the authorization matrix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  bootApp,
  cookiesOf,
  putToPresigned,
  resetDb,
  seedLimitedAdmin,
  seedRoles,
  seedSuperAdmin,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let adminCookies: string[];

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function makeVendor(email: string, password = 'VendorPass123') {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'V', lastName: 'Endor', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({
    data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
  });
  return { cookies: cookiesOf(reg), userId: user.id };
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

describe('vendor profile lifecycle', () => {
  let vendorCookies: string[];
  let profileId: string;

  it('starts with no profile', async () => {
    const v = await makeVendor('m2_vendor@example.bz');
    vendorCookies = v.cookies;
    const res = await request(ctx.server).get('/api/vendor/profile').set('Cookie', vendorCookies);
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
  });

  it('creates a DRAFT profile with a derived slug and default settings', async () => {
    const res = await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', vendorCookies)
      .send({ businessName: "Deshawn's Corner Store", contactEmail: 'shop@example.bz' });
    expect(res.status).toBe(201);
    expect(res.body.profile.slug).toBe('deshawn-s-corner-store');
    expect(res.body.profile.approvalStatus).toBe('DRAFT');
    expect(res.body.settings.pickupEnabled).toBe(true);
    profileId = res.body.profile.id;
  });

  it('rejects a second profile for the same user', async () => {
    const res = await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', vendorCookies)
      .send({ businessName: 'Another', contactEmail: 'x@example.bz' });
    expect(res.status).toBe(409);
  });

  it('updates profile fields and settings', async () => {
    const p = await request(ctx.server)
      .patch('/api/vendor/profile')
      .set('Cookie', vendorCookies)
      .send({ description: 'Groceries and household goods.', storeStatus: 'OPEN' });
    expect(p.status).toBe(200);
    expect(p.body.profile.storeStatus).toBe('OPEN');

    const s = await request(ctx.server)
      .patch('/api/vendor/settings')
      .set('Cookie', vendorCookies)
      .send({ vacationMode: true, minimumOrderMinor: 500, deliveryEnabled: true });
    expect(s.status).toBe(200);
    expect(s.body.settings.vacationMode).toBe(true);
    expect(s.body.settings.minimumOrderMinor).toBe(500);
  });

  it('manages locations with a single primary', async () => {
    await request(ctx.server)
      .post('/api/vendor/profile/locations')
      .set('Cookie', vendorCookies)
      .send({ label: 'Main', addressLine1: '1 King St', city: 'Belize City', district: 'BELIZE', isPrimary: true })
      .expect(201);
    const second = await request(ctx.server)
      .post('/api/vendor/profile/locations')
      .set('Cookie', vendorCookies)
      .send({ label: 'Branch', addressLine1: '2 Queen St', city: 'San Ignacio', district: 'CAYO', isPrimary: true });
    expect(second.status).toBe(201);
    const primaries = second.body.locations.filter((l: { isPrimary: boolean }) => l.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].label).toBe('Branch');
  });

  it('sets opening hours (replace-all) and validates times', async () => {
    const bad = await request(ctx.server)
      .put('/api/vendor/profile/hours')
      .set('Cookie', vendorCookies)
      .send({ hours: [{ dayOfWeek: 1, isClosed: false, openTime: '18:00', closeTime: '09:00' }] });
    expect(bad.status).toBe(400);

    const ok = await request(ctx.server)
      .put('/api/vendor/profile/hours')
      .set('Cookie', vendorCookies)
      .send({
        hours: [
          { dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '17:00' },
          { dayOfWeek: 0, isClosed: true },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.openingHours).toHaveLength(2);
  });

  it('uploads a logo to MinIO and stores the key (public bucket round-trip)', async () => {
    const presign = await request(ctx.server)
      .post('/api/vendor/profile/logo/presign')
      .set('Cookie', vendorCookies)
      .send({ fileName: 'logo.png', contentType: 'image/png', sizeBytes: PNG.length });
    expect(presign.status).toBe(201);
    expect(presign.body.key).toContain(`vendors/${profileId}/logo`);

    const put = await putToPresigned(presign.body.uploadUrl, PNG, 'image/png');
    expect(put).toBe(200);

    const confirm = await request(ctx.server)
      .post('/api/vendor/profile/logo/confirm')
      .set('Cookie', vendorCookies)
      .send({ key: presign.body.key });
    expect(confirm.status).toBe(201);
    expect(confirm.body.profile.logoKey).toBe(presign.body.key);
    expect(confirm.body.profile.logoUrl).toBeTruthy();
  });

  it('rejects a forged logo key from another namespace', async () => {
    const res = await request(ctx.server)
      .post('/api/vendor/profile/logo/confirm')
      .set('Cookie', vendorCookies)
      .send({ key: 'vendors/someone-else/logo/forged.png' });
    expect(res.status).toBe(400);
  });

  it('submits for review → PENDING with a SUBMITTED review + audit', async () => {
    const res = await request(ctx.server)
      .post('/api/vendor/profile/submit')
      .set('Cookie', vendorCookies);
    expect(res.status).toBe(201);
    expect(res.body.profile.approvalStatus).toBe('PENDING');

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'VENDOR_PROFILE_SUBMITTED' } });
    expect(audit).toBeTruthy();
    const review = await ctx.prisma.vendorModerationReview.findFirst({
      where: { vendorProfileId: profileId, action: 'SUBMITTED' },
    });
    expect(review).toBeTruthy();
  });

  it('admin approves → APPROVED, audit written, vendor notified', async () => {
    const list = await request(ctx.server)
      .get('/api/admin/vendors?status=PENDING')
      .set('Cookie', adminCookies);
    expect(list.status).toBe(200);
    expect(list.body.some((v: { id: string }) => v.id === profileId)).toBe(true);

    const approve = await request(ctx.server)
      .post(`/api/admin/vendors/${profileId}/approve`)
      .set('Cookie', adminCookies)
      .send({});
    expect(approve.status).toBe(201);
    expect(approve.body.approvalStatus).toBe('APPROVED');

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'VENDOR_APPROVED' } });
    expect(audit).toBeTruthy();
    const note = await request(ctx.server).get('/api/notifications').set('Cookie', vendorCookies);
    expect(note.body.items.some((n: { type: string }) => n.type === 'MARKETPLACE')).toBe(true);
  });

  it('cannot approve a non-PENDING profile', async () => {
    const res = await request(ctx.server)
      .post(`/api/admin/vendors/${profileId}/approve`)
      .set('Cookie', adminCookies)
      .send({});
    expect(res.status).toBe(409);
  });

  it('suspends then restores an approved profile', async () => {
    await request(ctx.server)
      .post(`/api/admin/vendors/${profileId}/suspend`)
      .set('Cookie', adminCookies)
      .send({ note: 'Compliance review.' })
      .expect(201);
    let detail = await request(ctx.server).get(`/api/admin/vendors/${profileId}`).set('Cookie', adminCookies);
    expect(detail.body.approvalStatus).toBe('SUSPENDED');

    await request(ctx.server)
      .post(`/api/admin/vendors/${profileId}/restore`)
      .set('Cookie', adminCookies)
      .send({})
      .expect(201);
    detail = await request(ctx.server).get(`/api/admin/vendors/${profileId}`).set('Cookie', adminCookies);
    expect(detail.body.approvalStatus).toBe('APPROVED');
    expect(detail.body.reviews.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining(['SUBMITTED', 'APPROVED', 'SUSPENDED', 'RESTORED']),
    );
  });
});

describe('rejection + ownership + authorization', () => {
  let vendorA: Awaited<ReturnType<typeof makeVendor>>;
  let vendorB: Awaited<ReturnType<typeof makeVendor>>;
  let aLocationId: string;

  beforeAll(async () => {
    vendorA = await makeVendor('m2_a@example.bz');
    vendorB = await makeVendor('m2_b@example.bz');

    await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', vendorA.cookies)
      .send({ businessName: 'Shop A', contactEmail: 'a@example.bz' })
      .expect(201);
    const loc = await request(ctx.server)
      .post('/api/vendor/profile/locations')
      .set('Cookie', vendorA.cookies)
      .send({ label: 'A', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE' });
    aLocationId = loc.body.locations[0].id;

    await request(ctx.server)
      .post('/api/vendor/profile')
      .set('Cookie', vendorB.cookies)
      .send({ businessName: 'Shop B', contactEmail: 'b@example.bz' })
      .expect(201);
  });

  it('requires a reason to reject', async () => {
    await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', vendorA.cookies).expect(201);
    const a = await request(ctx.server).get('/api/vendor/profile').set('Cookie', vendorA.cookies);
    const id = a.body.profile.id;

    const noReason = await request(ctx.server)
      .post(`/api/admin/vendors/${id}/reject`)
      .set('Cookie', adminCookies)
      .send({});
    expect(noReason.status).toBe(400);

    const rejected = await request(ctx.server)
      .post(`/api/admin/vendors/${id}/reject`)
      .set('Cookie', adminCookies)
      .send({ note: 'Business licence is unreadable.' });
    expect(rejected.status).toBe(201);
    expect(rejected.body.approvalStatus).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toContain('licence');
  });

  it("forbids vendor B from touching vendor A's location", async () => {
    const res = await request(ctx.server)
      .patch(`/api/vendor/profile/locations/${aLocationId}`)
      .set('Cookie', vendorB.cookies)
      .send({ label: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('forbids a customer from vendor endpoints and unauthenticated access', async () => {
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'm2_customer@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    const customerCookies = cookiesOf(reg);
    await request(ctx.server).get('/api/vendor/profile').set('Cookie', customerCookies).expect(403);
    await request(ctx.server).get('/api/vendor/profile').expect(401);
  });

  it('forbids an admin without vendors.moderate from approving', async () => {
    const limited = await seedLimitedAdmin(ctx.prisma, 'm2_limited@example.bz', ['vendors.read']);
    const limitedCookies = await login(limited.email, limited.password);
    const b = await request(ctx.server).get('/api/admin/vendors').set('Cookie', limitedCookies);
    expect(b.status).toBe(200); // read allowed
    const anyId = b.body[0]?.id;
    const res = await request(ctx.server)
      .post(`/api/admin/vendors/${anyId}/approve`)
      .set('Cookie', limitedCookies)
      .send({});
    expect(res.status).toBe(403);
  });
});
