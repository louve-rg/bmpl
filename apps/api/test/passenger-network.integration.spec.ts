/**
 * Passenger transportation — network structure (S2), against real Postgres.
 *
 * The claims this suite exists to defend:
 *  - a provider reaches ONLY their own routes and departures; admin reaches
 *    all of them, split read/moderate;
 *  - route and trip isTest are DERIVED from the owning operator, never from a
 *    request — including when an admin does the typing — and flipping the
 *    operator re-derives everything they already own, so the order of
 *    operations cannot leak a row across the boundary;
 *  - no fare exists: baseFareMinor is born null and no request can set it;
 *  - a route's endpoints freeze once departures exist, because a scheduled
 *    trip carries its geography on the route;
 *  - the tables ship empty — every network row (route, stop, trip) is created
 *    THROUGH the product, never by a raw database write. The one raw write in
 *    this file is the PASSENGER_PROVIDER role approval in makeProvider, which
 *    belongs to the role machinery, not to the surface under test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const TOMORROW = () => new Date(Date.now() + 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'P', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** An APPROVED operator with a profile — everything below acts through them. */
async function makeProvider(businessName: string) {
  const u = await registerUser(`pnet_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER' } },
    create: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string };
}

const limitedAdmin = async (permissions: string[]) => {
  const seeded = await seedLimitedAdmin(ctx.prisma, `pnlim_${uniq()}@example.bz`, permissions);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: seeded.email, password: seeded.password });
  return { id: seeded.id, cookies: cookiesOf(login) };
};

/** Test towns in a district the real network does not serve — plainly rehearsal names. */
const routeBody = () => ({
  name: `Test Coastal Run ${uniq()}`,
  originDistrict: 'TOLEDO',
  originCity: 'Test Landing North',
  destinationDistrict: 'TOLEDO',
  destinationCity: 'Test Landing South',
  scheduleNote: 'Mon-Sat 06:30',
  durationMinutes: 90,
  stops: [
    { district: 'TOLEDO', city: 'Test Midway One' },
    { district: 'TOLEDO', city: 'Test Midway Two', name: 'Market gate' },
  ],
});

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  await seedSuperAdmin(ctx.prisma);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.passengerTripAssignment.deleteMany();
  await ctx.prisma.passengerBooking.deleteMany();
  await ctx.prisma.passengerTrip.deleteMany();
  await ctx.prisma.passengerRouteStop.deleteMany();
  await ctx.prisma.passengerRoute.deleteMany();
  await ctx.prisma.passengerVehicle.deleteMany();
  await ctx.prisma.passengerDriverProfile.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ------------------------------------------------------------------------- */

describe('an operator describes their service', () => {
  it('creates a route with ordered stops, no fare, and an audit row naming them', async () => {
    const p = await makeProvider('Test Southern Shuttles');
    // Smuggled fields prove the two deliberate absences: both are stripped.
    const r = await post(p.cookies, 'passenger/provider/routes', { ...routeBody(), isTest: true, baseFareMinor: 5000 });
    expect(r.status).toBe(201);
    expect(r.body.stops.map((s: { sequence: number; city: string }) => [s.sequence, s.city])).toEqual([
      [1, 'Test Midway One'],
      [2, 'Test Midway Two'],
    ]);
    expect(r.body.baseFareMinor).toBeNull();
    expect(r.body.isTest).toBe(false);

    const row = await ctx.prisma.passengerRoute.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row.baseFareMinor).toBeNull();
    expect(row.isTest).toBe(false);

    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_ROUTE_CREATED' } })
    ).filter((a) => (a.newValue as { routeId?: string }).routeId === r.body.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(p.userId);
  });

  it('requires the operator role to be APPROVED, not merely applied for', async () => {
    const u = await registerUser(`pnorole_${uniq()}@example.com`);
    expect((await get(u.cookies, 'passenger/provider/routes')).status).toBe(403);
    expect((await post(u.cookies, 'passenger/provider/routes', routeBody())).status).toBe(403);
  });

  it('replaces stops as one ordered list, numbered by position', async () => {
    const p = await makeProvider('Test Stop Editors');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const replaced = await put(p.cookies, `passenger/provider/routes/${r.body.id}/stops`, [
      { district: 'TOLEDO', city: 'Test Midway Two' },
      { district: 'TOLEDO', city: 'Test Midway One' },
      { district: 'TOLEDO', city: 'Test Midway Three' },
    ]);
    expect(replaced.status).toBe(200);
    expect(replaced.body.stops.map((s: { sequence: number; city: string }) => [s.sequence, s.city])).toEqual([
      [1, 'Test Midway Two'],
      [2, 'Test Midway One'],
      [3, 'Test Midway Three'],
    ]);
  });
});

describe('a provider reaches only their own routes', () => {
  it('another operator cannot see, edit, or publish departures on them', async () => {
    const a = await makeProvider('Test Fleet A');
    const b = await makeProvider('Test Fleet B');
    const r = await post(a.cookies, 'passenger/provider/routes', routeBody());

    const bList = await get(b.cookies, 'passenger/provider/routes');
    expect(bList.body).toHaveLength(0);
    expect((await get(b.cookies, `passenger/provider/routes/${r.body.id}`)).status).toBe(404);
    expect((await patch(b.cookies, `passenger/provider/routes/${r.body.id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await put(b.cookies, `passenger/provider/routes/${r.body.id}/stops`, [])).status).toBe(404);
    expect(
      (await post(b.cookies, 'passenger/provider/trips', { routeId: r.body.id, scheduledDepartureAt: TOMORROW().toISOString() })).status,
    ).toBe(404);
  });
});

describe('published departures', () => {
  it('a trip is born SCHEDULED with a reference, and its flag comes from the route', async () => {
    const p = await makeProvider('Test Departure Co');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const t = await post(p.cookies, 'passenger/provider/trips', {
      routeId: r.body.id,
      scheduledDepartureAt: TOMORROW().toISOString(),
      isTest: true, // smuggle attempt — stripped
    });
    expect(t.status).toBe(201);
    expect(t.body.kind).toBe('SCHEDULED');
    expect(t.body.status).toBe('SCHEDULED');
    expect(t.body.reference).toMatch(/^BML-T[A-Z2-9]{7}$/);
    expect(t.body.isTest).toBe(false);
    expect(t.body.providerProfileId).toBe(p.profileId);

    const mine = await get(p.cookies, 'passenger/provider/trips');
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(t.body.id);

    // Publishing names who typed it in — here, the operator themselves.
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_TRIP_CREATED' } })
    ).filter((a) => (a.newValue as { tripId?: string }).tripId === t.body.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(p.userId);
  });

  it('refuses a departure in the past, and any departure of an inactive route', async () => {
    const p = await makeProvider('Test Timekeepers');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const past = await post(p.cookies, 'passenger/provider/trips', {
      routeId: r.body.id,
      scheduledDepartureAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    });
    expect(past.status).toBe(400);
    expect(past.body.message).toMatch(/already passed/i);

    await patch(p.cookies, `passenger/provider/routes/${r.body.id}`, { isActive: false });
    const onDead = await post(p.cookies, 'passenger/provider/trips', {
      routeId: r.body.id,
      scheduledDepartureAt: TOMORROW().toISOString(),
    });
    expect(onDead.status).toBe(400);
    expect(onDead.body.message).toMatch(/inactive/i);
  });

  it('a scheduled departure can be retracted — once — and the retraction is audited', async () => {
    const p = await makeProvider('Test Cancellers');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const t = await post(p.cookies, 'passenger/provider/trips', { routeId: r.body.id, scheduledDepartureAt: TOMORROW().toISOString() });
    const cancelled = await post(p.cookies, `passenger/provider/trips/${t.body.id}/cancel`, { reason: 'Vehicle in the shop.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelledBy).toBe('PROVIDER');
    expect(cancelled.body.cancellationReason).toBe('Vehicle in the shop.');

    expect((await post(p.cookies, `passenger/provider/trips/${t.body.id}/cancel`)).status).toBe(400);

    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_TRIP_CANCELLED' } })
    ).filter((a) => (a.newValue as { tripId?: string }).tripId === t.body.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(p.userId);
  });
});

describe('a route with departures cannot quietly move', () => {
  it('endpoint edits are refused once a departure exists; labels stay editable', async () => {
    const p = await makeProvider('Test Immovables');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    // Before any departure, endpoints may still be corrected.
    expect((await patch(p.cookies, `passenger/provider/routes/${r.body.id}`, { originCity: 'Test Landing West' })).status).toBe(200);

    const t = await post(p.cookies, 'passenger/provider/trips', { routeId: r.body.id, scheduledDepartureAt: TOMORROW().toISOString() });
    const moved = await patch(p.cookies, `passenger/provider/routes/${r.body.id}`, { destinationCity: 'Test Landing East' });
    expect(moved.status).toBe(400);
    expect(moved.body.message).toMatch(/have been published/i);
    // The schedule label is not geography.
    expect((await patch(p.cookies, `passenger/provider/routes/${r.body.id}`, { scheduleNote: 'Daily 05:00' })).status).toBe(200);

    // The ordered stop list is frozen by the same rule — it is equally part of
    // what riders were promised, and the replace endpoint must not be a
    // side door around the endpoint freeze.
    const stopsMoved = await put(p.cookies, `passenger/provider/routes/${r.body.id}/stops`, [
      { district: 'TOLEDO', city: 'Test Midway Rewritten' },
    ]);
    expect(stopsMoved.status).toBe(400);
    expect(stopsMoved.body.message).toMatch(/have been published/i);

    // And a CANCELLED departure still freezes — it is history, not absence.
    // The message stays true for an operator with nothing outstanding.
    await post(p.cookies, `passenger/provider/trips/${t.body.id}/cancel`);
    const afterCancel = await patch(p.cookies, `passenger/provider/routes/${r.body.id}`, { destinationCity: 'Test Landing East' });
    expect(afterCancel.status).toBe(400);
    expect(afterCancel.body.message).toMatch(/since cancelled/i);
  });
});

describe('admin oversight', () => {
  it('read can see every operator; only moderate can act, and the audit names the admin', async () => {
    const a = await makeProvider('Test Fleet North');
    const b = await makeProvider('Test Fleet South');
    await post(a.cookies, 'passenger/provider/routes', routeBody());
    await post(b.cookies, 'passenger/provider/routes', routeBody());

    const reader = await limitedAdmin(['passengers.read']);
    const moderator = await limitedAdmin(['passengers.moderate']);

    const all = await get(reader.cookies, 'admin/passengers/routes');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);
    expect(all.body.map((r: { provider: { businessName: string } }) => r.provider.businessName).sort()).toEqual([
      'Test Fleet North',
      'Test Fleet South',
    ]);

    // Looking is not deciding.
    expect((await post(reader.cookies, 'admin/passengers/routes', { ...routeBody(), providerProfileId: a.profileId })).status).toBe(403);

    // Moderate creates ON BEHALF of an operator: the route is theirs, not the admin's.
    const created = await post(moderator.cookies, 'admin/passengers/routes', { ...routeBody(), providerProfileId: a.profileId });
    expect(created.status).toBe(201);
    const ownList = await get(a.cookies, 'passenger/provider/routes');
    expect(ownList.body.map((r: { id: string }) => r.id)).toContain(created.body.id);

    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_ROUTE_CREATED' } })
    ).filter((x) => (x.newValue as { routeId?: string }).routeId === created.body.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(moderator.id);
    expect(audits[0]!.targetUserId).toBe(a.userId);
  });

  it('can retract any operator’s departure, recorded as ADMIN', async () => {
    const p = await makeProvider('Test Overseen Lines');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const t = await post(p.cookies, 'passenger/provider/trips', { routeId: r.body.id, scheduledDepartureAt: TOMORROW().toISOString() });

    const moderator = await limitedAdmin(['passengers.moderate']);
    const cancelled = await post(moderator.cookies, `admin/passengers/trips/${t.body.id}/cancel`, { reason: 'Operator unreachable.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.cancelledBy).toBe('ADMIN');
  });

  it('an admin-published departure is distinguishable from the operator’s own', async () => {
    const p = await makeProvider('Test Ghostwritten Lines');
    const r = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const moderator = await limitedAdmin(['passengers.moderate']);
    const t = await post(moderator.cookies, 'admin/passengers/trips', {
      routeId: r.body.id,
      scheduledDepartureAt: TOMORROW().toISOString(),
    });
    expect(t.status).toBe(201);
    // The row alone cannot say who published — the audit trail can, and does.
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_TRIP_CREATED' } })
    ).filter((a) => (a.newValue as { tripId?: string }).tripId === t.body.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(moderator.id);
    expect(audits[0]!.targetUserId).toBe(p.userId);
  });

  it('refuses a plain customer everywhere', async () => {
    const u = await registerUser(`pnetadm_${uniq()}@example.com`);
    expect((await get(u.cookies, 'admin/passengers/routes')).status).toBe(403);
    expect((await get(u.cookies, 'admin/passengers/trips')).status).toBe(403);
    expect((await post(u.cookies, 'admin/passengers/trips/nonexistent/cancel')).status).toBe(403);
  });
});

describe('the simulation boundary', () => {
  it('a test operator’s routes and departures are test-side by derivation, whoever types them in', async () => {
    const p = await makeProvider('Test Rehearsal Lines');
    const moderator = await limitedAdmin(['passengers.moderate']);
    expect((await patch(moderator.cookies, `admin/passengers/providers/${p.profileId}/test-mode`, { isTest: true })).status).toBe(200);

    // Provider-created: derived.
    const own = await post(p.cookies, 'passenger/provider/routes', routeBody());
    expect(own.body.isTest).toBe(true);
    // Admin-created for the same operator: still derived, not asserted.
    const admin = await post(moderator.cookies, 'admin/passengers/routes', { ...routeBody(), providerProfileId: p.profileId, isTest: false });
    expect(admin.status).toBe(201);
    expect(admin.body.isTest).toBe(true);
    // And a departure inherits through the route.
    const t = await post(p.cookies, 'passenger/provider/trips', { routeId: own.body.id, scheduledDepartureAt: TOMORROW().toISOString() });
    expect(t.body.isTest).toBe(true);
  });

  it('flipping the operator re-derives what they already own — the reverse order cannot leak', async () => {
    // The A8/F1 trace, closed: the route and vehicle exist BEFORE the flip.
    // Write-time derivation alone would leave them real-side forever, and
    // every later departure would inherit the stale flag from the ROUTE.
    const p = await makeProvider('Test Latecomer Lines');
    const preRoute = await post(p.cookies, 'passenger/provider/routes', routeBody());
    const preVehicle = await post(p.cookies, 'passenger/provider/vehicles', {
      type: 'VAN',
      make: 'Toyota',
      model: 'Hiace',
      licencePlate: `PNV-${uniq()}`.slice(0, 18),
      seatCapacity: 12,
    });
    expect(preRoute.body.isTest).toBe(false);
    expect(preVehicle.status).toBe(201);

    const moderator = await limitedAdmin(['passengers.moderate']);
    const flip = await patch(moderator.cookies, `admin/passengers/providers/${p.profileId}/test-mode`, { isTest: true });
    expect(flip.status).toBe(200);

    // Everything owned crossed the boundary with its owner, atomically.
    const routeRow = await ctx.prisma.passengerRoute.findUniqueOrThrow({ where: { id: preRoute.body.id } });
    expect(routeRow.isTest).toBe(true);
    const vehicleRow = await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: preVehicle.body.id } });
    expect(vehicleRow.isTest).toBe(true);

    // And a departure published AFTER the flip on the pre-flip route is
    // test-side — the exact request that used to leak a real-side trip.
    const t = await post(p.cookies, 'passenger/provider/trips', {
      routeId: preRoute.body.id,
      scheduledDepartureAt: TOMORROW().toISOString(),
    });
    expect(t.status).toBe(201);
    expect(t.body.isTest).toBe(true);

    // The audit rows record how much the flip carried across.
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_PROVIDER_TEST_MODE_CHANGED' } })
    ).filter((a) => (a.newValue as { passengerProviderProfileId?: string }).passengerProviderProfileId === p.profileId);
    expect(audits).toHaveLength(1);
    expect((audits[0]!.newValue as { routesRederived?: number }).routesRederived).toBe(1);
    expect((audits[0]!.newValue as { vehiclesRederived?: number }).vehiclesRederived).toBe(1);
  });
});
