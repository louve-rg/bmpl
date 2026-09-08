/**
 * The rider surface's authorization boundary (BMPL-85), against real Postgres.
 *
 * BMPL-83 found that this was the one owner-named case proven NOWHERE: the
 * guard chain answers 401/403 today — production was measured doing it — but
 * no spec pinned it, so a refactor could quietly open a rider endpoint and
 * nothing would go red. This file exists so that removing or weakening the
 * guard on any rider endpoint fails a test.
 *
 * Two refusal shapes per endpoint, each paired with the SAME REQUEST
 * succeeding for the authorized caller — a refusal without its twin success
 * proves nothing (an endpoint that 401s everyone passes the refusal half
 * vacuously):
 *
 *  - LOGGED OUT: no session at all -> 401 from authentication.
 *  - WRONG ROLE: a signed-in account whose CUSTOMER role is not APPROVED
 *    -> 403 from the roles guard. The realistic wrong-role caller is a
 *    SUSPENDED customer (registration grants everyone CUSTOMER/APPROVED, and
 *    both admin seed helpers include it — a super admin is deliberately NOT
 *    a wrong-role caller here, because admins ARE customers by construction).
 *
 * Refusals are attributable only to the guard: every refused request targets
 * a real, priced, otherwise-bookable departure or a real booking, with a
 * valid body — nothing else in the pipeline has grounds to say no. After each
 * refused mutation the row is re-read to prove nothing changed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const TOMORROW = () => new Date(Date.now() + 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
/** No Cookie header at all — the logged-out caller. */
const anonGet = (p: string) => request(ctx.server).get(`/api/${p}`);
const anonPost = (p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'R', lastName: 'A', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** A signed-in account that is NOT an approved customer: suspended after registration. */
async function makeSuspendedCustomer() {
  const u = await registerUser(`ra_susp_${uniq()}@example.com`);
  await ctx.prisma.userRole.update({
    where: { userId_roleCode: { userId: u.userId, roleCode: 'CUSTOMER' } },
    data: { status: 'SUSPENDED' },
  });
  return u;
}

async function makeProvider(businessName: string) {
  const u = await registerUser(`ra_op_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER' } },
    create: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string };
}

/** A priced, published departure — bookable by an approved customer, so a
 *  refusal below can only be the guard's. */
async function makePricedDeparture(operator: { cookies: string[] }) {
  const route = await post(operator.cookies, 'passenger/provider/routes', {
    name: `Test Auth Run ${uniq()}`,
    originDistrict: 'TOLEDO',
    originCity: 'Test Landing North',
    destinationDistrict: 'TOLEDO',
    destinationCity: 'Test Landing South',
    baseFareMinor: 2000,
  });
  expect(route.status).toBe(201);
  const trip = await post(operator.cookies, 'passenger/provider/trips', {
    routeId: route.body.id,
    scheduledDepartureAt: TOMORROW().toISOString(),
  });
  expect(trip.status).toBe(201);
  return trip.body.id as string;
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
  await ctx.prisma.passengerBooking.deleteMany();
  await ctx.prisma.passengerTrip.deleteMany();
  await ctx.prisma.passengerRouteStop.deleteMany();
  await ctx.prisma.passengerRoute.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ------------------------------------------------------------------------- */

describe('the rider auth boundary — every endpoint refuses the unauthorized and serves the authorized', () => {
  it('browse: logged-out 401, suspended customer 403, approved customer sees the departure', async () => {
    const op = await makeProvider('Test Boundary Coaches');
    const tripId = await makePricedDeparture(op);

    expect((await anonGet('passenger/departures')).status).toBe(401);
    expect((await get((await makeSuspendedCustomer()).cookies, 'passenger/departures')).status).toBe(403);

    // The twin success, on CONTENT not just status — an empty 200 would
    // prove nothing about what the refusals were protecting.
    const rider = await registerUser(`ra_r1_${uniq()}@example.com`);
    const view = await get(rider.cookies, 'passenger/departures');
    expect(view.status).toBe(200);
    expect(view.body.map((d: { id: string }) => d.id)).toContain(tripId);
  });

  it('booking create: logged-out and suspended write nothing; the same body books 201 for the rider', async () => {
    const op = await makeProvider('Test Boundary Booked');
    const tripId = await makePricedDeparture(op);
    const body = { tripId, seats: 1 };

    expect((await anonPost('passenger/bookings', body)).status).toBe(401);
    expect((await post((await makeSuspendedCustomer()).cookies, 'passenger/bookings', body)).status).toBe(403);
    // Neither refusal left a row behind.
    expect(await ctx.prisma.passengerBooking.count()).toBe(0);

    const rider = await registerUser(`ra_r2_${uniq()}@example.com`);
    const booked = await post(rider.cookies, 'passenger/bookings', body);
    expect(booked.status).toBe(201);
    expect(booked.body.status).toBe('REQUESTED');
  });

  it('booking list: refused outside, and inside shows the rider their own booking', async () => {
    const op = await makeProvider('Test Boundary Lists');
    const tripId = await makePricedDeparture(op);
    const rider = await registerUser(`ra_r3_${uniq()}@example.com`);
    const booked = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(booked.status).toBe(201);

    expect((await anonGet('passenger/bookings')).status).toBe(401);
    expect((await get((await makeSuspendedCustomer()).cookies, 'passenger/bookings')).status).toBe(403);

    const mine = await get(rider.cookies, 'passenger/bookings');
    expect(mine.status).toBe(200);
    expect(mine.body.map((b: { id: string }) => b.id)).toContain(booked.body.id);
  });

  it('booking cancel: the guard refuses before ownership is even asked — and the booking survives untouched until its owner acts', async () => {
    const op = await makeProvider('Test Boundary Cancels');
    const tripId = await makePricedDeparture(op);
    const rider = await registerUser(`ra_r4_${uniq()}@example.com`);
    const booked = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(booked.status).toBe(201);
    const cancelPath = `passenger/bookings/${booked.body.id}/cancel`;

    expect((await anonPost(cancelPath)).status).toBe(401);
    expect((await post((await makeSuspendedCustomer()).cookies, cancelPath)).status).toBe(403);
    // Both refusals happened at the door: the booking did not move.
    const untouched = await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: booked.body.id } });
    expect(untouched.status).toBe('REQUESTED');

    const own = await post(rider.cookies, cancelPath, { reason: 'Boundary test complete.' });
    expect(own.status).toBe(201);
    expect(own.body.status).toBe('CANCELLED');
  });
});
