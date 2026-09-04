/**
 * Passenger transportation — booking & movement behind the fare gate (S3),
 * against real Postgres.
 *
 * The claims this suite exists to defend:
 *  - THE FARE GATE: no configured fare (null or zero) means no booking and no
 *    confirmation — a plain-words "pricing unavailable" refusal, never a
 *    fare-less or BZ$0.00 booking, and nothing ever computes or quotes an
 *    amount (fareQuotedMinor stays null in every row this suite creates);
 *  - SEATS ARE HELD AT CONFIRMATION, NOT AT REQUEST, and confirmation fails
 *    closed when capacity is unknown (no vehicle) or spent;
 *  - the self-service invariant on userId, both directions: the person
 *    driving a departure holds no seat on it;
 *  - isTest symmetry end to end, including the reverse order: a rider with
 *    live bookings cannot be flipped across the boundary;
 *  - manual staffing only, fleet drivers only, approved vehicles only.
 *
 * Every route, departure, booking, assignment and movement step is created
 * THROUGH the API. The raw writes are role approvals, the fleet-affiliation
 * link (its management API is deliberately unbuilt — the consent model is an
 * open product question), and one isActive=false write in the suspension
 * test, which exists precisely because no product path can write it (the S2
 * review's F5, still open, honoured here as a live check).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const TOMORROW = () => new Date(Date.now() + 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'P', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function approveRole(userId: string, roleCode: 'PASSENGER_DRIVER' | 'PASSENGER_PROVIDER') {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode } },
    create: { userId, roleCode, status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
}

async function makeProvider(businessName: string) {
  const u = await registerUser(`pb_op_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_PROVIDER');
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string };
}

/**
 * A fleet driver, driving-ready. The affiliation link is a raw write: fleet
 * membership has NO management API yet (the consent model is an open product
 * question, deferred since S1) — until that ships, real operators cannot
 * staff departures at all, which is reported as a sequencing gap, not hidden.
 */
async function makeFleetDriver(providerProfileId: string) {
  const u = await registerUser(`pb_drv_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_DRIVER');
  const prof = await put(u.cookies, 'passenger/driver/profile', {
    legalName: 'Pat Driver',
    displayName: `PBDrv${uniq()}`,
    phone: '+5016100000',
    homeDistrict: 'TOLEDO',
    licenceNumber: `PBDL-${uniq()}`,
    licenceExpiry: TOMORROW().toISOString(),
    termsAccepted: true,
  });
  expect(prof.status).toBe(200);
  await ctx.prisma.passengerDriverProfile.update({ where: { userId: u.userId }, data: { providerProfileId } });
  const profile = await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { userId: u.userId } });
  return { ...u, driverProfileId: profile.id };
}

/** An APPROVED fleet vehicle, registered and moderated through the product. */
async function makeFleetVehicle(operator: { cookies: string[] }, seatCapacity: number) {
  const v = await post(operator.cookies, 'passenger/provider/vehicles', {
    type: 'VAN',
    make: 'Toyota',
    model: 'Hiace',
    licencePlate: `PB-${uniq()}`.slice(0, 18),
    seatCapacity,
  });
  expect(v.status).toBe(201);
  expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
  return v.body.id as string;
}

const routeBody = (fareMinor?: number) => ({
  name: `Test Booking Run ${uniq()}`,
  originDistrict: 'TOLEDO',
  originCity: 'Test Landing North',
  destinationDistrict: 'TOLEDO',
  destinationCity: 'Test Landing South',
  scheduleNote: 'Mon-Sat 06:30',
  ...(fareMinor !== undefined ? { baseFareMinor: fareMinor } : {}),
});

/** A published departure on a fresh route, all through the API. */
async function makeDeparture(operator: { cookies: string[] }, fareMinor?: number) {
  const route = await post(operator.cookies, 'passenger/provider/routes', routeBody(fareMinor));
  expect(route.status).toBe(201);
  const trip = await post(operator.cookies, 'passenger/provider/trips', {
    routeId: route.body.id,
    scheduledDepartureAt: TOMORROW().toISOString(),
  });
  expect(trip.status).toBe(201);
  return { routeId: route.body.id as string, tripId: trip.body.id as string, tripReference: trip.body.reference as string };
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

describe('the fare gate', () => {
  it('refuses to book an unpriced service, in words about pricing rather than a null column', async () => {
    const op = await makeProvider('Test Unpriced Lines');
    const { tripId } = await makeDeparture(op); // no fare configured
    const rider = await registerUser(`pb_r1_${uniq()}@example.com`);

    const r = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/pricing.*not available/i);
    expect(await ctx.prisma.passengerBooking.count()).toBe(0);
  });

  it('zero is not a price', async () => {
    const op = await makeProvider('Test Zero Lines');
    const { tripId } = await makeDeparture(op, 0);
    const rider = await registerUser(`pb_r2_${uniq()}@example.com`);
    const r = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/pricing.*not available/i);
  });

  it('a configured fare opens the gate — and the booking still quotes nothing', async () => {
    const op = await makeProvider('Test Priced Lines');
    const { tripId } = await makeDeparture(op, 2500);
    const rider = await registerUser(`pb_r3_${uniq()}@example.com`);

    const r = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 2, isTest: true });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('REQUESTED');
    expect(r.body.reference).toMatch(/^BML-B[A-Z2-9]{7}$/);
    expect(r.body.isTest).toBe(false); // smuggle stripped; derived from the rider

    const row = await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: r.body.id } });
    // The whole point of the ruling: a fare EXISTS, but nothing computed one.
    expect(row.fareQuotedMinor).toBeNull();
    expect(row.fareBasis).toBeNull();
  });

  it('holds at confirmation too: a fare zeroed after the request refuses the seat', async () => {
    const op = await makeProvider('Test Regressed Lines');
    const { routeId, tripId } = await makeDeparture(op, 2500);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 12);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);
    const rider = await registerUser(`pb_r4_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(b.status).toBe(201);

    expect((await patch(op.cookies, `passenger/provider/routes/${routeId}`, { baseFareMinor: 0 })).status).toBe(200);
    const confirm = await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`);
    expect(confirm.status).toBe(400);
    expect(confirm.body.message).toMatch(/pricing.*not available/i);
  });
});

describe('seats are held at confirmation, not at request', () => {
  it('cannot confirm before a vehicle gives the departure a capacity', async () => {
    const op = await makeProvider('Test Capacityless');
    const { tripId } = await makeDeparture(op, 2000);
    const rider = await registerUser(`pb_r5_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    const confirm = await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`);
    expect(confirm.status).toBe(400);
    expect(confirm.body.message).toMatch(/assign a vehicle/i);
  });

  it('fails closed when capacity is spent, and a cancellation frees the seats', async () => {
    const op = await makeProvider('Test Full Bus');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 2);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    const riderA = await registerUser(`pb_r6_${uniq()}@example.com`);
    const riderB = await registerUser(`pb_r7_${uniq()}@example.com`);
    const a = await post(riderA.cookies, 'passenger/bookings', { tripId, seats: 2 });
    const b = await post(riderB.cookies, 'passenger/bookings', { tripId, seats: 1 });
    // Requests reserve nothing: BOTH exist while only 2 seats do.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    expect((await post(op.cookies, `passenger/provider/bookings/${a.body.id}/confirm`)).status).toBe(201);
    const overflow = await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`);
    expect(overflow.status).toBe(400);
    expect(overflow.body.message).toMatch(/not enough seats/i);

    // The operator frees the held seats; the waiting request can now be honoured.
    expect((await post(op.cookies, `passenger/provider/bookings/${a.body.id}/cancel`, { reason: 'Rider asked us to.' })).status).toBe(201);
    expect((await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`)).status).toBe(201);

    const confirmed = await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: b.body.id } });
    expect(confirmed.status).toBe('CONFIRMED');
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_BOOKING_CONFIRMED' } })
    ).filter((x) => (x.newValue as { bookingId?: string }).bookingId === b.body.id);
    expect(audits).toHaveLength(1);
  });
});

describe('manual staffing', () => {
  it('assigns a fleet driver and an approved vehicle, snapshots capacity, and names the assigner', async () => {
    const op = await makeProvider('Test Staffed Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 14);

    const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('ASSIGNED');
    expect(r.body.seatCapacity).toBe(14);

    const assignment = await ctx.prisma.passengerTripAssignment.findFirstOrThrow({ where: { tripId } });
    expect(assignment.status).toBe('ACTIVE');
    expect(assignment.assignedByUserId).toBe(op.userId);
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_TRIP_ASSIGNED' } })
    ).filter((x) => (x.newValue as { tripId?: string }).tripId === tripId);
    expect(audits).toHaveLength(1);
  });

  it('refuses an independent driver — affiliation is a question nobody has answered', async () => {
    const op = await makeProvider('Test Fleetless');
    const { tripId } = await makeDeparture(op, 2000);
    const independent = await makeFleetDriver(op.profileId);
    // Sever the affiliation: an independent, fully-approved driver.
    await ctx.prisma.passengerDriverProfile.update({ where: { id: independent.driverProfileId }, data: { providerProfileId: null } });
    const vehicleId = await makeFleetVehicle(op, 12);
    const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: independent.driverProfileId, vehicleId });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/own fleet drivers/i);
  });

  it('refuses an unapproved vehicle', async () => {
    const op = await makeProvider('Test Unmoderated Wheels');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const v = await post(op.cookies, 'passenger/provider/vehicles', {
      type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: `PBX-${uniq()}`.slice(0, 18), seatCapacity: 12,
    }); // registered but never moderated
    const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: v.body.id });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not approved/i);
  });
});

describe('the self-service invariant, on userId, both directions', () => {
  it('the assigned driver cannot book a seat; a seated rider cannot be assigned to drive', async () => {
    const op = await makeProvider('Test Conflict Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 12);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    // Direction one: the person behind the wheel asks for a seat.
    const asRider = await post(driver.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(asRider.status).toBe(400);
    expect(asRider.body.message).toMatch(/assigned to drive/i);

    // Direction two: a seated rider is proposed as the driver of another departure.
    const { tripId: secondTrip } = await makeDeparture(op, 2000);
    const ridingDriver = await makeFleetDriver(op.profileId);
    expect((await post(ridingDriver.cookies, 'passenger/bookings', { tripId: secondTrip, seats: 1 })).status).toBe(201);
    const r = await post(op.cookies, `passenger/provider/trips/${secondTrip}/assign`, { driverProfileId: ridingDriver.driverProfileId, vehicleId });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/holds a booking/i);
  });
});

describe('movement', () => {
  it('start closes the doors, completion settles the manifest — and the unanswered request is left alone', async () => {
    const op = await makeProvider('Test Moving Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 12);
    await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });

    const confirmedRider = await registerUser(`pb_r8_${uniq()}@example.com`);
    const confirmed = await post(confirmedRider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    await post(op.cookies, `passenger/provider/bookings/${confirmed.body.id}/confirm`);
    const unansweredRider = await registerUser(`pb_r9_${uniq()}@example.com`);
    const unanswered = await post(unansweredRider.cookies, 'passenger/bookings', { tripId, seats: 1 });

    // A stranger to the trip cannot start it.
    const other = await makeFleetDriver(op.profileId);
    expect((await post(other.cookies, `passenger/driver/trips/${tripId}/start`)).status).toBe(404);

    expect((await post(driver.cookies, `passenger/driver/trips/${tripId}/start`)).status).toBe(201);
    // Doors closed: no new bookings on a moving vehicle.
    const late = await registerUser(`pb_r10_${uniq()}@example.com`);
    expect((await post(late.cookies, 'passenger/bookings', { tripId, seats: 1 })).status).toBe(400);

    expect((await post(driver.cookies, `passenger/driver/trips/${tripId}/complete`)).status).toBe(201);

    const trip = await ctx.prisma.passengerTrip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe('COMPLETED');
    expect((await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: confirmed.body.id } })).status).toBe('COMPLETED');
    // What becomes of an unanswered request when the bus leaves is an open
    // product question (EXPIRED timing) — it is deliberately NOT invented here.
    expect((await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: unanswered.body.id } })).status).toBe('REQUESTED');
    expect((await ctx.prisma.passengerTripAssignment.findFirstOrThrow({ where: { tripId } })).status).toBe('COMPLETED');
    expect((await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { id: driver.driverProfileId } })).completedTrips).toBe(1);
  });

  it('cancelling a staffed departure cancels its riders with it, attributed to the canceller', async () => {
    const op = await makeProvider('Test Cancelled Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 12);
    await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });
    const rider = await registerUser(`pb_r11_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`);

    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/cancel`, { reason: 'Vehicle fault.' })).status).toBe(201);
    const booking = await ctx.prisma.passengerBooking.findUniqueOrThrow({ where: { id: b.body.id } });
    expect(booking.status).toBe('CANCELLED');
    expect(booking.cancelledBy).toBe('PROVIDER');
    expect((await ctx.prisma.passengerTripAssignment.findFirstOrThrow({ where: { tripId } })).status).toBe('CANCELLED');
  });

  it('a rider cancels their own booking and nobody else’s', async () => {
    const op = await makeProvider('Test Changed Minds');
    const { tripId } = await makeDeparture(op, 2000);
    const rider = await registerUser(`pb_r12_${uniq()}@example.com`);
    const stranger = await registerUser(`pb_r13_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });

    expect((await post(stranger.cookies, `passenger/bookings/${b.body.id}/cancel`)).status).toBe(404);
    const own = await post(rider.cookies, `passenger/bookings/${b.body.id}/cancel`, { reason: 'Plans changed.' });
    expect(own.status).toBe(201);
    expect(own.body.cancelledBy).toBe('PASSENGER');
  });
});

describe('the simulation boundary, end to end', () => {
  it('a test rider browses only the test network; a real rider cannot reach a test departure by id', async () => {
    const op = await makeProvider('Test Boundary Lines');
    const moderator = await seedLimitedAdmin(ctx.prisma, `pb_mod_${uniq()}@example.bz`, ['passengers.moderate']);
    const mc = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: moderator.email, password: moderator.password }));
    expect((await patch(mc, `admin/passengers/providers/${op.profileId}/test-mode`, { isTest: true })).status).toBe(200);
    const { tripId } = await makeDeparture(op, 2000); // inherits test-side

    const testRider = await registerUser(`pb_tr_${uniq()}@example.com`);
    expect((await post(admin, 'admin/users/test-flag', { userId: testRider.userId, isTest: true, reason: 'S3 boundary test.' })).status).toBe(201);
    const realRider = await registerUser(`pb_rr_${uniq()}@example.com`);

    const testView = await get(testRider.cookies, 'passenger/departures');
    expect(testView.body.map((d: { id: string }) => d.id)).toContain(tripId);
    const realView = await get(realRider.cookies, 'passenger/departures');
    expect(realView.body.map((d: { id: string }) => d.id)).not.toContain(tripId);
    // By id, the answer is "no such departure" — existence is not revealed.
    expect((await post(realRider.cookies, 'passenger/bookings', { tripId, seats: 1 })).status).toBe(404);
  });

  it('a rider with live bookings cannot be flipped across the boundary — the reverse order is closed', async () => {
    const op = await makeProvider('Test Sticky Riders');
    const { tripId } = await makeDeparture(op, 2000);
    const rider = await registerUser(`pb_fl_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(b.status).toBe(201);

    // The S2 lesson: the booking snapshotted the rider's flag at creation, so
    // the source may not move while the snapshot is live.
    const flip = await post(admin, 'admin/users/test-flag', { userId: rider.userId, isTest: true, reason: 'Too late.' });
    expect(flip.status).toBe(400);
    expect(flip.body.message).toMatch(/open passenger booking/i);

    await post(rider.cookies, `passenger/bookings/${b.body.id}/cancel`);
    expect((await post(admin, 'admin/users/test-flag', { userId: rider.userId, isTest: true, reason: 'Now it is fine.' })).status).toBe(201);
  });
});

describe('oversight and suspension', () => {
  it('read looks, moderate acts — and admin actions are attributed as ADMIN', async () => {
    const op = await makeProvider('Test Overseen Movement');
    const { tripId } = await makeDeparture(op, 2000);
    const rider = await registerUser(`pb_r14_${uniq()}@example.com`);
    const b = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });

    const reader = await seedLimitedAdmin(ctx.prisma, `pb_read_${uniq()}@example.bz`, ['passengers.read']);
    const rc = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: reader.email, password: reader.password }));
    expect((await get(rc, 'admin/passengers/bookings')).status).toBe(200);
    expect((await post(rc, `admin/passengers/bookings/${b.body.id}/cancel`)).status).toBe(403);

    const cancelled = await post(admin, `admin/passengers/bookings/${b.body.id}/cancel`, { reason: 'Operator request via support.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.cancelledBy).toBe('ADMIN');
  });

  it('a suspended operator takes no bookings and staffs nothing', async () => {
    const op = await makeProvider('Test Suspended Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op.profileId);
    const vehicleId = await makeFleetVehicle(op, 12);
    // Raw write BY NECESSITY: no product path can suspend an operator (the S2
    // review's F5, still unbuilt). The checks below are live so the moment a
    // suspension control ships, it already bites everywhere it must.
    await ctx.prisma.passengerProviderProfile.update({ where: { id: op.profileId }, data: { isActive: false } });

    const rider = await registerUser(`pb_r15_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(booking.status).toBe(400);
    expect(booking.body.message).toMatch(/not currently operating/i);
    const staffed = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });
    expect(staffed.status).toBe(400);
    expect(staffed.body.message).toMatch(/suspended/i);
  });
});
