/**
 * Vendor date-specific hours exceptions — WRITE SURFACE (BMPL-334), against
 * real Postgres. Self-service, not admin: mirrors hub-hours.integration.spec.ts's
 * write-surface coverage exactly (same rejection cases, same replace-on-
 * resubmit, same CHECK-constraint backstop), adapted to `@Roles('VENDOR')`
 * scoped to the caller's own profile instead of an admin permission.
 *
 * No real vendor hours or holiday dates appear anywhere in this file — every
 * day/time/date/reason below is a synthetic fixture, never a real BML
 * vendor's schedule or a real Belize public holiday.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** One synthetic vendor, no hours configured yet. */
async function makeVendor() {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Store ${s}`,
      slug: `store-${s}`,
      contactEmail: `v${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
    },
  });
  return { cookies, userId };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  await seedSuperAdmin(ctx.prisma);
});
afterAll(async () => { await ctx.app.close(); });

describe('vendor hours exceptions (BMPL-334)', () => {
  it('an unconfigured vendor has no weekly pattern and no exceptions', async () => {
    const vendor = await makeVendor();
    const res = await get(vendor.cookies, 'vendor/profile');
    expect(res.status).toBe(200);
    expect(res.body.openingHours).toEqual([]);
    expect(res.body.hoursExceptions).toEqual([]);
  });

  it('adds, lists and removes a CLOSED date-specific exception', async () => {
    const vendor = await makeVendor();
    const added = await post(vendor.cookies, 'vendor/profile/hours/exceptions', {
      date: '2026-12-25',
      status: 'CLOSED',
      reason: 'Synthetic test closure — not a real BML vendor holiday',
    });
    expect(added.status).toBe(201);
    const exceptionId = (added.body.hoursExceptions as Array<{ id: string; date: string }>).find((e) => e.date.startsWith('2026-12-25'))!.id;

    const profile = await get(vendor.cookies, 'vendor/profile');
    expect(profile.body.hoursExceptions).toHaveLength(1);
    expect(profile.body.hoursExceptions[0]).toMatchObject({ id: exceptionId, status: 'CLOSED', openTime: null, closeTime: null });

    // Re-submitting the same date REPLACES it rather than duplicating.
    const replaced = await post(vendor.cookies, 'vendor/profile/hours/exceptions', {
      date: '2026-12-25',
      status: 'MODIFIED',
      openTime: '10:00',
      closeTime: '13:00',
      reason: 'Synthetic: revised plan',
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body.hoursExceptions).toHaveLength(1);
    expect(replaced.body.hoursExceptions[0].id).toBe(exceptionId);
    expect(await ctx.prisma.vendorHoursException.count({ where: { vendorProfileId: replaced.body.hoursExceptions[0].vendorProfileId } })).toBe(1);

    expect((await del(vendor.cookies, `vendor/profile/hours/exceptions/${exceptionId}`)).status).toBe(200);
    expect((await get(vendor.cookies, 'vendor/profile')).body.hoursExceptions).toEqual([]);
  });

  it('adds a MODIFIED exception with both times, and it round-trips exactly', async () => {
    const vendor = await makeVendor();
    const added = await post(vendor.cookies, 'vendor/profile/hours/exceptions', {
      date: '2026-11-19',
      status: 'MODIFIED',
      openTime: '11:00',
      closeTime: '14:00',
      reason: 'Synthetic: half day for a family event',
    });
    expect(added.status).toBe(201);
    expect(added.body.hoursExceptions).toContainEqual(
      expect.objectContaining({ status: 'MODIFIED', openTime: '11:00', closeTime: '14:00' }),
    );
  });

  // THE REJECTION CASES (the whole reason this card asked for them, per
  // BMPL-284's own precedent): a bad combination must come back as a real
  // validation error, not a 500 from the database CHECK
  // (vendor_hours_exceptions_times_match_status).
  describe('rejects an incoherent exception before it reaches the database', () => {
    // Scoped to THIS test's own vendor — beforeAll (not beforeEach) resets
    // the database once for the whole file, so an earlier test's rows (the
    // "adds, lists and removes" / "adds a MODIFIED" cases above) are still
    // present, exactly the reason hub-hours.integration.spec.ts's own
    // version of this test scopes its count by hubId rather than counting
    // the whole table.
    it('MODIFIED with only openTime set', async () => {
      const vendor = await makeVendor();
      const res = await post(vendor.cookies, 'vendor/profile/hours/exceptions', { date: '2026-12-01', status: 'MODIFIED', openTime: '11:00' });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.vendorHoursException.count({ where: { vendorProfile: { userId: vendor.userId } } })).toBe(0);
    });

    it('MODIFIED with neither time set', async () => {
      const vendor = await makeVendor();
      const res = await post(vendor.cookies, 'vendor/profile/hours/exceptions', { date: '2026-12-01', status: 'MODIFIED' });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.vendorHoursException.count({ where: { vendorProfile: { userId: vendor.userId } } })).toBe(0);
    });

    it('MODIFIED with closeTime before openTime', async () => {
      const vendor = await makeVendor();
      const res = await post(vendor.cookies, 'vendor/profile/hours/exceptions', {
        date: '2026-12-01', status: 'MODIFIED', openTime: '14:00', closeTime: '11:00',
      });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.vendorHoursException.count({ where: { vendorProfile: { userId: vendor.userId } } })).toBe(0);
    });

    it('CLOSED with a time set anyway', async () => {
      const vendor = await makeVendor();
      const res = await post(vendor.cookies, 'vendor/profile/hours/exceptions', { date: '2026-12-01', status: 'CLOSED', openTime: '09:00' });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.vendorHoursException.count({ where: { vendorProfile: { userId: vendor.userId } } })).toBe(0);
    });
  });

  it('removing a nonexistent exception 404s', async () => {
    const vendor = await makeVendor();
    expect((await del(vendor.cookies, 'vendor/profile/hours/exceptions/nonexistent00000000000000')).status).toBe(404);
  });

  it('a vendor cannot see or remove another vendor\'s exception — 404, not just an empty list', async () => {
    const a = await makeVendor();
    const b = await makeVendor();
    const added = await post(a.cookies, 'vendor/profile/hours/exceptions', { date: '2026-12-01', status: 'CLOSED' });
    expect(added.status).toBe(201);
    const exceptionId = added.body.hoursExceptions[0].id as string;

    // B never sees it in their own profile...
    expect((await get(b.cookies, 'vendor/profile')).body.hoursExceptions).toEqual([]);
    // ...and cannot delete it by guessing the id, even though it is a real row.
    expect((await del(b.cookies, `vendor/profile/hours/exceptions/${exceptionId}`)).status).toBe(404);
    expect(await ctx.prisma.vendorHoursException.count({ where: { id: exceptionId } })).toBe(1);
  });

  it('a non-vendor is refused entirely', async () => {
    const { cookies } = await registerCustomer(`cust_${uniq()}@example.bz`);
    expect((await post(cookies, 'vendor/profile/hours/exceptions', { date: '2026-12-01', status: 'CLOSED' })).status).toBe(403);
  });
});
