/**
 * Carrier route operating-day CONFIGURATION (BMPL-186), against real Postgres.
 *
 * The claim this suite exists to defend: A CARRIER CONFIGURES WHETHER ITS OWN
 * ROUTE RUNS ON A GIVEN DATE, AND NOTHING ELSE'S. The weekly pattern and its
 * date exceptions are shared read/write paths (LogisticsNetworkService) so
 * admin and the carrier's own surface compute the schedule exactly the same
 * way; a cross-org route id answers 404 exactly like a missing one, mirroring
 * the carrier-org-access precedent for legs.
 *
 * No real schedule data appears anywhere in this file — every day/date/reason
 * below is a synthetic fixture, never a real BML carrier's timetable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function approveProviderRole(userId: string) {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'SHIPPING_PROVIDER' } },
    create: { userId, roleCode: 'SHIPPING_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
}

/** An org: approved owner + self-service profile (births the OWNER membership). */
async function makeCarrier(name: string) {
  const owner = await registerUser(`sown_${uniq()}@example.com`);
  await approveProviderRole(owner.userId);
  const created = await put(owner.cookies, 'shipping/provider/profile', {
    businessName: name,
    contactEmail: `sops_${uniq()}@example.com`,
  });
  expect(created.status).toBe(200);
  return { ...owner, profileId: created.body.id as string };
}

/** One synthetic SEA route, standing-operated by `profileId` (or unowned if omitted). */
async function makeRoute(profileId?: string) {
  const suffix = uniq();
  const o = await post(admin, 'admin/logistics/hubs', {
    code: `SO${suffix}`.slice(0, 12), name: `Synthetic Origin Dock ${suffix}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: 'Synthetic Origin Town', modes: ['LAND', 'SEA'], courierFeeMinor: 500,
  });
  expect(o.status).toBe(201);
  const d = await post(admin, 'admin/logistics/hubs', {
    code: `SD${suffix}`.slice(0, 12), name: `Synthetic Destination Dock ${suffix}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: 'Synthetic Destination Town', modes: ['LAND', 'SEA'], courierFeeMinor: 500,
  });
  expect(d.status).toBe(201);
  const r = await post(admin, 'admin/logistics/routes', {
    originHubId: o.body.id, destinationHubId: d.body.id, mode: 'SEA',
    durationMinutes: 45, priceMinor: 2500, carrierName: 'Synthetic Test Carrier',
    ...(profileId ? { operatedByProviderId: profileId } : {}),
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.routeScheduleException.deleteMany();
  await ctx.prisma.routeOperatingDay.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.shippingProviderMember.deleteMany();
  await ctx.prisma.shippingProviderProfile.deleteMany();
});

describe('admin route schedule', () => {
  it('an unconfigured route has no weekly pattern and no exceptions', async () => {
    const routeId = await makeRoute();
    const schedule = await get(admin, `admin/logistics/routes/${routeId}/schedule`);
    expect(schedule.status).toBe(200);
    expect(schedule.body.days).toEqual([]);
    expect(schedule.body.exceptions).toEqual([]);
  });

  it('sets the whole weekly pattern in one call, and a resubmit REPLACES it rather than merging', async () => {
    const routeId = await makeRoute();
    const first = await put(admin, `admin/logistics/routes/${routeId}/schedule`, {
      days: [
        { dayOfWeek: 0, status: 'REDUCED', note: 'Synthetic: one vessel only' },
        { dayOfWeek: 3, status: 'NOT_OPERATING' },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body.days).toHaveLength(2);

    // A second submission with only ONE day removes the other - no stale row survives.
    const second = await put(admin, `admin/logistics/routes/${routeId}/schedule`, {
      days: [{ dayOfWeek: 1, status: 'OPERATING' }],
    });
    expect(second.status).toBe(200);
    expect(second.body.days).toEqual([{ dayOfWeek: 1, status: 'OPERATING', note: null }]);

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'ROUTE_SCHEDULE_CHANGED' }, orderBy: { createdAt: 'desc' } });
    expect(audit).toBeTruthy();
  });

  it('refuses a duplicate day-of-week and an out-of-range one', async () => {
    const routeId = await makeRoute();
    expect((await put(admin, `admin/logistics/routes/${routeId}/schedule`, {
      days: [{ dayOfWeek: 2, status: 'OPERATING' }, { dayOfWeek: 2, status: 'NOT_OPERATING' }],
    })).status).toBe(400);
    expect((await put(admin, `admin/logistics/routes/${routeId}/schedule`, { days: [{ dayOfWeek: 9, status: 'OPERATING' }] })).status).toBe(400);
  });

  it('adds, lists and removes a date-specific exception', async () => {
    const routeId = await makeRoute();
    const added = await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: '2026-12-25', status: 'NOT_OPERATING', reason: 'Synthetic test holiday - not a real BML closure',
    });
    expect(added.status).toBe(201);
    const exceptionId = added.body.id as string;

    const schedule = await get(admin, `admin/logistics/routes/${routeId}/schedule`);
    expect(schedule.body.exceptions).toEqual([
      { id: exceptionId, date: '2026-12-25', status: 'NOT_OPERATING', reason: 'Synthetic test holiday - not a real BML closure' },
    ]);

    // Re-submitting the same date REPLACES it rather than duplicating.
    const replaced = await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: '2026-12-25', status: 'REDUCED', reason: 'Synthetic: revised plan',
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body.id).toBe(exceptionId);
    expect((await ctx.prisma.routeScheduleException.count({ where: { routeId } }))).toBe(1);

    expect((await del(admin, `admin/logistics/routes/${routeId}/schedule/exceptions/${exceptionId}`)).status).toBe(200);
    expect((await get(admin, `admin/logistics/routes/${routeId}/schedule`)).body.exceptions).toEqual([]);
  });

  it('logistics.read may view but not write; logistics.manage may do both', async () => {
    const routeId = await makeRoute();
    const reader = await seedLimitedAdmin(ctx.prisma, `sreader_${uniq()}@example.bz`, ['logistics.read']);
    const readerCookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: reader.email, password: reader.password }));
    expect((await get(readerCookies, `admin/logistics/routes/${routeId}/schedule`)).status).toBe(200);
    expect((await put(readerCookies, `admin/logistics/routes/${routeId}/schedule`, { days: [{ dayOfWeek: 0, status: 'OPERATING' }] })).status).toBe(403);

    const manager = await seedLimitedAdmin(ctx.prisma, `smanager_${uniq()}@example.bz`, ['logistics.read', 'logistics.manage']);
    const managerCookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: manager.email, password: manager.password }));
    expect((await put(managerCookies, `admin/logistics/routes/${routeId}/schedule`, { days: [{ dayOfWeek: 0, status: 'OPERATING' }] })).status).toBe(200);
  });
});

describe('the carrier surface', () => {
  it('demands the role and an ACTIVE membership, same two gates as the legs surface', async () => {
    const routeId = await makeRoute();
    expect((await request(ctx.server).get(`/api/shipping/provider/routes/${routeId}/schedule`)).status).toBe(401);
    const roleOnly = await registerUser(`srole_${uniq()}@example.com`);
    await approveProviderRole(roleOnly.userId);
    // Role but zero ACTIVE memberships: myOrgIds refuses outright (403), same as the legs surface.
    expect((await get(roleOnly.cookies, `shipping/provider/routes/${routeId}/schedule`)).status).toBe(403);
  });

  it("a carrier reads and configures its OWN route's schedule through the same surface admin uses", async () => {
    const carrier = await makeCarrier('Synthetic Reef Runner Ltd');
    const routeId = await makeRoute(carrier.profileId);

    expect((await get(carrier.cookies, 'shipping/provider/routes')).body).toHaveLength(1);

    const set = await put(carrier.cookies, `shipping/provider/routes/${routeId}/schedule`, {
      days: [{ dayOfWeek: 0, status: 'NOT_OPERATING', note: 'Synthetic: no Sunday service' }],
    });
    expect(set.status).toBe(200);

    const exception = await post(carrier.cookies, `shipping/provider/routes/${routeId}/schedule/exceptions`, {
      date: '2026-11-19', status: 'REDUCED', reason: 'Synthetic: one vessel in maintenance',
    });
    expect(exception.status).toBe(201);

    // Admin sees exactly what the carrier configured - one shared truth.
    const adminView = await get(admin, `admin/logistics/routes/${routeId}/schedule`);
    expect(adminView.body.days).toEqual([{ dayOfWeek: 0, status: 'NOT_OPERATING', note: 'Synthetic: no Sunday service' }]);
    expect(adminView.body.exceptions[0].reason).toBe('Synthetic: one vessel in maintenance');

    expect((await del(carrier.cookies, `shipping/provider/routes/${routeId}/schedule/exceptions/${exception.body.id}`)).status).toBe(200);
  });

  it('REQUIRED: one carrier cannot alter, add to, or remove another carrier\'s route schedule - a cross-org id reads exactly like a missing one', async () => {
    const carrierA = await makeCarrier('Synthetic Reef Runner Ltd');
    const carrierB = await makeCarrier('Synthetic Cave Branch Bus Co');
    const routeId = await makeRoute(carrierA.profileId);

    // Seed a real weekly pattern and exception on A's route first.
    await put(carrierA.cookies, `shipping/provider/routes/${routeId}/schedule`, { days: [{ dayOfWeek: 2, status: 'OPERATING' }] });
    const seeded = await post(carrierA.cookies, `shipping/provider/routes/${routeId}/schedule/exceptions`, {
      date: '2026-12-25', status: 'NOT_OPERATING', reason: 'Synthetic test holiday',
    });
    expect(seeded.status).toBe(201);

    // B cannot read it, set it, add to it, or remove from it - all 404, indistinguishable from a bogus id.
    const missingId = 'nonexistent00000000000000';
    const bRead = await get(carrierB.cookies, `shipping/provider/routes/${routeId}/schedule`);
    const missingRead = await get(carrierB.cookies, `shipping/provider/routes/${missingId}/schedule`);
    expect(bRead.status).toBe(404);
    expect(bRead.body).toEqual(missingRead.body);

    const bWrite = await put(carrierB.cookies, `shipping/provider/routes/${routeId}/schedule`, { days: [{ dayOfWeek: 5, status: 'NOT_OPERATING' }] });
    expect(bWrite.status).toBe(404);

    const bException = await post(carrierB.cookies, `shipping/provider/routes/${routeId}/schedule/exceptions`, {
      date: '2027-01-01', status: 'NOT_OPERATING',
    });
    expect(bException.status).toBe(404);

    const bRemove = await del(carrierB.cookies, `shipping/provider/routes/${routeId}/schedule/exceptions/${seeded.body.id}`);
    expect(bRemove.status).toBe(404);

    // A's data is completely untouched by B's attempts.
    const stillA = await get(carrierA.cookies, `shipping/provider/routes/${routeId}/schedule`);
    expect(stillA.body.days).toEqual([{ dayOfWeek: 2, status: 'OPERATING', note: null }]);
    expect(stillA.body.exceptions).toHaveLength(1);

    // B also cannot see A's route in its own listing.
    expect((await get(carrierB.cookies, 'shipping/provider/routes')).body).toEqual([]);
  });

  it('an ended membership cuts schedule access on the very next request; the org keeps working', async () => {
    const carrier = await makeCarrier('Synthetic Reef Runner Ltd');
    const routeId = await makeRoute(carrier.profileId);
    const staff = await registerUser(`sstaff_${uniq()}@example.com`);
    await approveProviderRole(staff.userId);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members`, { userId: staff.userId })).status).toBe(201);
    expect((await get(staff.cookies, `shipping/provider/routes/${routeId}/schedule`)).status).toBe(200);

    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members/${staff.userId}/end`)).status).toBe(201);
    // Zero ACTIVE memberships left: myOrgIds refuses outright (403), same as the legs surface.
    expect((await get(staff.cookies, `shipping/provider/routes/${routeId}/schedule`)).status).toBe(403);
    // The organization itself is unaffected.
    expect((await get(carrier.cookies, `shipping/provider/routes/${routeId}/schedule`)).status).toBe(200);
  });
});
