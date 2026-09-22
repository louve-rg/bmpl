/**
 * Passenger bookings — the scoping that was true but unpinned (BMPL-160),
 * against real Postgres.
 *
 * The BMPL-159 audit found three authorization lines that were correct in
 * code and asserted nowhere. This suite pins them:
 *
 *  - a foreign OPERATOR confirming or cancelling a booking on another
 *    operator's departure reads exactly like a missing booking, and the
 *    probe changes nothing;
 *  - an operator's booking LIST carries their riders and nobody else's;
 *  - a rider's booking LIST shows their own bookings and no one else's —
 *    ABSENCE asserted explicitly, because a scoping regression on a list
 *    leaks quietly rather than erroring, and two riders on the SAME
 *    departure is exactly the case a wrong join would merge.
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

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'P', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeProvider(businessName: string) {
  const u = await registerUser(`ps_op_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER' } },
    create: { userId: u.userId, roleCode: 'PASSENGER_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string };
}

/** A priced, published departure on a fresh route, all through the API. */
async function makeDeparture(operator: { cookies: string[] }) {
  const route = await post(operator.cookies, 'passenger/provider/routes', {
    name: `Test Scope Run ${uniq()}`,
    originDistrict: 'TOLEDO',
    originCity: 'Test Landing North',
    destinationDistrict: 'TOLEDO',
    destinationCity: 'Test Landing South',
    scheduleNote: 'Mon-Sat 06:30',
    baseFareMinor: 2000,
  });
  expect(route.status).toBe(201);
  const trip = await post(operator.cookies, 'passenger/provider/trips', {
    routeId: route.body.id,
    scheduledDepartureAt: TOMORROW().toISOString(),
  });
  expect(trip.status).toBe(201);
  return { tripId: trip.body.id as string };
}

async function book(rider: { cookies: string[] }, tripId: string) {
  const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
  expect(b.status).toBe(201);
  return b.body.id as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  expect(admin.length).toBeGreaterThan(0);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.passengerTripAssignment.deleteMany();
  await ctx.prisma.passengerBooking.deleteMany();
  await ctx.prisma.passengerTrip.deleteMany();
  await ctx.prisma.passengerVehicle.deleteMany();
  await ctx.prisma.passengerRouteStop.deleteMany();
  await ctx.prisma.passengerRoute.deleteMany();
  await ctx.prisma.passengerDriverProfile.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ------------------------------------------------------------------------- */

describe('booking scope: the lines that were true but unpinned (BMPL-160)', () => {
  it("a foreign operator confirming or cancelling reads exactly like a missing booking — and the probe changes nothing", async () => {
    const owner = await makeProvider('Test Coastal Line');
    const rival = await makeProvider('Test Rival Line');
    const { tripId } = await makeDeparture(owner);
    const rider = await registerUser(`ps_r_${uniq()}@example.com`);
    const bookingId = await book(rider, tripId);

    // Confirm, through the wrong operator: foreign and missing are one answer.
    const foreignConfirm = await post(rival.cookies, `passenger/provider/bookings/${bookingId}/confirm`);
    const missingConfirm = await post(rival.cookies, 'passenger/provider/bookings/nonexistent00000000000000/confirm');
    expect(foreignConfirm.status).toBe(404);
    expect(missingConfirm.status).toBe(404);
    expect(foreignConfirm.body).toEqual(missingConfirm.body);

    // Cancel, same door, same answer.
    const foreignCancel = await post(rival.cookies, `passenger/provider/bookings/${bookingId}/cancel`, { reason: 'Not mine to touch.' });
    const missingCancel = await post(rival.cookies, 'passenger/provider/bookings/nonexistent00000000000000/cancel', { reason: 'x' });
    expect(foreignCancel.status).toBe(404);
    expect(missingCancel.status).toBe(404);
    expect(foreignCancel.body).toEqual(missingCancel.body);

    // The probes changed nothing: the booking still awaits ITS operator…
    const row = await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).toBe('REQUESTED');
    // …and the two operators are refused at DIFFERENT gates, which is the
    // whole point: the owner reaches the action and is stopped by the
    // capacity rule (no vehicle assigned on this lean fixture); the stranger
    // never learns the booking exists at all.
    const ownerConfirm = await post(owner.cookies, `passenger/provider/bookings/${bookingId}/confirm`);
    expect(ownerConfirm.status).toBe(400);
    expect(ownerConfirm.body.message).toMatch(/assign a vehicle/i);
  });

  it("an operator's booking list carries their riders and nobody else's", async () => {
    const opA = await makeProvider('Test North Ferries');
    const opB = await makeProvider('Test South Buses');
    const { tripId: tripA } = await makeDeparture(opA);
    const { tripId: tripB } = await makeDeparture(opB);
    const riderA = await registerUser(`ps_ra_${uniq()}@example.com`);
    const riderB = await registerUser(`ps_rb_${uniq()}@example.com`);
    const bookingA = await book(riderA, tripA);
    const bookingB = await book(riderB, tripB);

    const listA = await get(opA.cookies, 'passenger/provider/bookings');
    const listB = await get(opB.cookies, 'passenger/provider/bookings');
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    const idsA = listA.body.map((b: { id: string }) => b.id);
    const idsB = listB.body.map((b: { id: string }) => b.id);
    // Presence proves the list works; absence proves it is SCOPED.
    expect(idsA).toContain(bookingA);
    expect(idsA).not.toContain(bookingB);
    expect(idsB).toContain(bookingB);
    expect(idsB).not.toContain(bookingA);
  });

  it("a rider's booking list shows their own and no one else's — two riders on the SAME departure stay two histories", async () => {
    const op = await makeProvider('Test Shared Departure Co');
    const { tripId } = await makeDeparture(op);
    // The same trip on purpose: a wrong scoping join (by trip, by operator,
    // or a dropped where) merges exactly these two.
    const riderA = await registerUser(`ps_r1_${uniq()}@example.com`);
    const riderB = await registerUser(`ps_r2_${uniq()}@example.com`);
    const bookingA = await book(riderA, tripId);
    const bookingB = await book(riderB, tripId);

    const mineA = await get(riderA.cookies, 'passenger/bookings');
    const mineB = await get(riderB.cookies, 'passenger/bookings');
    expect(mineA.status).toBe(200);
    expect(mineB.status).toBe(200);
    const idsA = mineA.body.map((b: { id: string }) => b.id);
    const idsB = mineB.body.map((b: { id: string }) => b.id);
    expect(idsA).toContain(bookingA);
    expect(idsA).not.toContain(bookingB);
    expect(idsB).toContain(bookingB);
    expect(idsB).not.toContain(bookingA);
    // Belt and braces on the quiet-leak channel: nothing about the other
    // rider's booking rides along in any field of my list.
    expect(JSON.stringify(mineA.body)).not.toContain(bookingB);
    expect(JSON.stringify(mineB.body)).not.toContain(bookingA);
  });
});
