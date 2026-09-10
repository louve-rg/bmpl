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
 *  - manual staffing only, fleet drivers only, approved vehicles only;
 *  - rider discovery answers from the SAME door as the departures list: one
 *    visibility predicate for services, list and by-id detail, so nothing is
 *    readable by id that the list would have hidden.
 *
 * Every route, departure, booking, assignment and movement step is created
 * THROUGH the API — including, since BMPL-39, the fleet-affiliation link
 * (operator invites, driver accepts: mutual consent). The raw writes left are
 * role approvals and one isActive=false write in the suspension test, which
 * exists precisely because no product path can write it (the S2 review's F5,
 * still open, honoured here as a live check).
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
 * A fleet driver, driving-ready, whose membership goes THROUGH the product:
 * the operator invites and the driver accepts — BMPL-39's mutual consent,
 * exercised on every fixture rather than bypassed by a raw write.
 */
async function makeFleetDriver(operator: { cookies: string[]; profileId: string }) {
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
  const invite = await post(operator.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: prof.body.id });
  expect(invite.status).toBe(201);
  const accepted = await post(u.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`);
  expect(accepted.status).toBe(201);
  expect(accepted.body.status).toBe('ACCEPTED');
  return { ...u, driverProfileId: prof.body.id as string, affiliationId: invite.body.id as string };
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
    const driver = await makeFleetDriver(op);
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
    const driver = await makeFleetDriver(op);
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
    const driver = await makeFleetDriver(op);
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

  it('refuses an independent driver — fleet membership is consented, never assumed', async () => {
    const op = await makeProvider('Test Fleetless');
    const { tripId } = await makeDeparture(op, 2000);
    const independent = await makeFleetDriver(op);
    // Sever the affiliation THROUGH the product: the driver leaves the fleet.
    expect((await post(independent.cookies, `passenger/driver/affiliations/${independent.affiliationId}/end`)).status).toBe(201);
    const vehicleId = await makeFleetVehicle(op, 12);
    const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: independent.driverProfileId, vehicleId });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/own fleet drivers/i);
  });

  it('refuses an unapproved vehicle', async () => {
    const op = await makeProvider('Test Unmoderated Wheels');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op);
    const v = await post(op.cookies, 'passenger/provider/vehicles', {
      type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: `PBX-${uniq()}`.slice(0, 18), seatCapacity: 12,
    }); // registered but never moderated
    const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: v.body.id });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not approved/i);
  });

  it('an assigned departure says who is driving, in what, and how many seats remain', async () => {
    // Assignment was act-able but not see-able: the trip serializer carried no
    // driver, vehicle or seat arithmetic, so a Departures screen could not show
    // WHO is on a trip once it left SCHEDULED.
    const op = await makeProvider('Test Visible Staffing');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op);
    const vehicleId = await makeFleetVehicle(op, 10);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    const rider = await registerUser(`pb_vis_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 3 });
    expect(booking.status).toBe(201);
    expect((await post(op.cookies, `passenger/provider/bookings/${booking.body.id}/confirm`)).status).toBe(201);

    // Operator and admin read the same truth.
    for (const [cookies, path] of [
      [op.cookies, 'passenger/provider/trips'],
      [admin, 'admin/passengers/trips'],
    ] as const) {
      const list = await get(cookies, path);
      expect(list.status).toBe(200);
      const t = list.body.find((x: { id: string }) => x.id === tripId);
      expect(t.driverProfileId).toBe(driver.driverProfileId);
      expect(t.driverName).toMatch(/^PBDrv/);
      expect(t.vehicle).toMatchObject({ make: 'Toyota', model: 'Hiace' });
      expect(t.seatCapacity).toBe(10);
      expect(t.seatsConfirmed).toBe(3);
      expect(t.seatsRemaining).toBe(7);
    }

    // And the drivers listing names the fleet, so an assign flow can narrow to
    // the operator's own drivers before the server has to refuse a wrong pick.
    const drivers = await get(admin, 'admin/passengers/drivers');
    expect(drivers.status).toBe(200);
    const row = drivers.body.find((d: { id: string }) => d.id === driver.driverProfileId);
    expect(row.providerProfileId).toBe(op.profileId);
  });
});

describe('the self-service invariant, on userId, both directions', () => {
  it('the assigned driver cannot book a seat; a seated rider cannot be assigned to drive', async () => {
    const op = await makeProvider('Test Conflict Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op);
    const vehicleId = await makeFleetVehicle(op, 12);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    // Direction one: the person behind the wheel asks for a seat.
    const asRider = await post(driver.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(asRider.status).toBe(400);
    expect(asRider.body.message).toMatch(/assigned to drive/i);

    // Direction two: a seated rider is proposed as the driver of another departure.
    const { tripId: secondTrip } = await makeDeparture(op, 2000);
    const ridingDriver = await makeFleetDriver(op);
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
    const driver = await makeFleetDriver(op);
    const vehicleId = await makeFleetVehicle(op, 12);
    await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });

    const confirmedRider = await registerUser(`pb_r8_${uniq()}@example.com`);
    const confirmed = await post(confirmedRider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    await post(op.cookies, `passenger/provider/bookings/${confirmed.body.id}/confirm`);
    const unansweredRider = await registerUser(`pb_r9_${uniq()}@example.com`);
    const unanswered = await post(unansweredRider.cookies, 'passenger/bookings', { tripId, seats: 1 });

    // A stranger to the trip cannot start it.
    const other = await makeFleetDriver(op);
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

    // …but the rider is never trapped with it (QA finding F1): withdrawing
    // your own unanswered request works even AFTER the departure completed —
    // the state that previously had no exit at all. This decides nothing
    // about automatic expiry; it is a person tidying their own list.
    const withdrawal = await post(unansweredRider.cookies, `passenger/bookings/${unanswered.body.id}/cancel`, { reason: 'Never confirmed.' });
    expect(withdrawal.status).toBe(201);
    expect(withdrawal.body.status).toBe('CANCELLED');
    expect(withdrawal.body.cancelledBy).toBe('PASSENGER');
    // The COMPLETED booking stays settled history — no exit reopens for it.
    expect((await post(confirmedRider.cookies, `passenger/bookings/${confirmed.body.id}/cancel`)).status).toBe(400);
  });

  it('cancelling a staffed departure cancels its riders with it, attributed to the canceller', async () => {
    const op = await makeProvider('Test Cancelled Lines');
    const { tripId } = await makeDeparture(op, 2000);
    const driver = await makeFleetDriver(op);
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

describe('rider discovery and departure detail', () => {
  it('services are discoverable with nothing scheduled, the unpriced ones honestly so', async () => {
    const op = await makeProvider('Test Discovery Lines');
    const unpriced = await post(op.cookies, 'passenger/provider/routes', routeBody());
    expect(unpriced.status).toBe(201);
    const stops = await put(op.cookies, `passenger/provider/routes/${unpriced.body.id}/stops`, [
      { district: 'TOLEDO', city: 'Test Landing Middle', name: 'Market' },
    ] as unknown as object);
    expect(stops.status).toBe(200);
    const priced = await post(op.cookies, 'passenger/provider/routes', routeBody(2500));
    expect(priced.status).toBe(201);

    const rider = await registerUser(`pb_disc_${uniq()}@example.com`);
    // Nothing is scheduled, so the departures list is honestly empty — this
    // was the whole gap: the rider could not learn the services exist at all.
    expect((await get(rider.cookies, 'passenger/departures')).body).toEqual([]);

    const services = await get(rider.cookies, 'passenger/services');
    expect(services.status).toBe(200);
    const u = services.body.find((s: { id: string }) => s.id === unpriced.body.id);
    expect(u).toMatchObject({
      originDistrict: 'TOLEDO',
      originCity: 'Test Landing North',
      destinationCity: 'Test Landing South',
      scheduleNote: 'Mon-Sat 06:30',
      operator: 'Test Discovery Lines',
      // The pricing-unavailable state, shown rather than hidden: no figure,
      // and no figure invented.
      baseFareMinor: null,
      fareConfigured: false,
    });
    expect(u.stops).toEqual([
      { sequence: 1, district: 'TOLEDO', city: 'Test Landing Middle', name: 'Market', latitude: null, longitude: null },
    ]);
    const p = services.body.find((s: { id: string }) => s.id === priced.body.id);
    expect(p).toMatchObject({ baseFareMinor: 2500, fareConfigured: true, stops: [] });
  });

  it('the detail is the list entry plus the ordered stops, knows its seat arithmetic, and opens no way past the fare gate', async () => {
    const op = await makeProvider('Test Detail Lines');
    // Stops go on before the departure publishes (the promise then freezes) —
    // ordered by the OPERATOR, and deliberately not in geographic order, so a
    // sorted answer would be caught.
    const route = await post(op.cookies, 'passenger/provider/routes', routeBody(2500));
    expect(route.status).toBe(201);
    const stopsPut = await put(op.cookies, `passenger/provider/routes/${route.body.id}/stops`, [
      { district: 'TOLEDO', city: 'Test Landing East' },
      { district: 'TOLEDO', city: 'Test Landing Middle', name: 'Market' },
    ] as unknown as object);
    expect(stopsPut.status).toBe(200);
    const trip = await post(op.cookies, 'passenger/provider/trips', { routeId: route.body.id, scheduledDepartureAt: TOMORROW().toISOString() });
    expect(trip.status).toBe(201);
    const tripId = trip.body.id as string;
    const rider = await registerUser(`pb_det_${uniq()}@example.com`);

    const list = await get(rider.cookies, 'passenger/departures');
    const entry = list.body.find((d: { id: string }) => d.id === tripId);
    expect(entry).toBeTruthy();
    // The list stays exactly as it was — stops live on the detail.
    expect(entry.route).not.toHaveProperty('stops');
    const detail = await get(rider.cookies, `passenger/departures/${tripId}`);
    expect(detail.status).toBe(200);
    // The rider at an intermediate stop gets their answer: the operator's
    // sequence verbatim — East first, Market second, exactly as stored.
    expect(detail.body.route.stops).toEqual([
      { sequence: 1, district: 'TOLEDO', city: 'Test Landing East', name: null, latitude: null, longitude: null },
      { sequence: 2, district: 'TOLEDO', city: 'Test Landing Middle', name: 'Market', latitude: null, longitude: null },
    ]);
    // Drift guard: one predicate, one serializer — apart from the stops, the
    // detail IS the list entry.
    const { stops: _stops, ...detailRoute } = detail.body.route;
    expect({ ...detail.body, route: detailRoute }).toEqual(entry);

    // Staff it and sell some seats; the detail keeps counting like the list.
    const driver = await makeFleetDriver(op);
    const vehicleId = await makeFleetVehicle(op, 12);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);
    const buyer = await registerUser(`pb_det2_${uniq()}@example.com`);
    const b = await post(buyer.cookies, 'passenger/bookings', { tripId, seats: 3 });
    expect((await post(op.cookies, `passenger/provider/bookings/${b.body.id}/confirm`)).status).toBe(201);
    const after = await get(rider.cookies, `passenger/departures/${tripId}`);
    expect(after.body.status).toBe('ASSIGNED');
    expect(after.body.seatCapacity).toBe(12);
    expect(after.body.seatsConfirmed).toBe(3);

    // An unpriced departure is READABLE — that is the pricing-unavailable
    // state doing its job — and booking it still refuses at the gate.
    const { tripId: unpricedTrip } = await makeDeparture(op);
    const d2 = await get(rider.cookies, `passenger/departures/${unpricedTrip}`);
    expect(d2.status).toBe(200);
    expect(d2.body.fareConfigured).toBe(false);
    expect(d2.body.baseFareMinor).toBeNull();
    const refused = await post(rider.cookies, 'passenger/bookings', { tripId: unpricedTrip, seats: 1 });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/pricing.*not available/i);
  });

  it('what the list would hide, discovery and detail hide too: wrong boundary side, inactive route, suspended operator, unknown id', async () => {
    // A test-side network, built through the product then flipped by a moderator.
    const testOp = await makeProvider('Test Otherside Lines');
    const moderator = await seedLimitedAdmin(ctx.prisma, `pb_dmod_${uniq()}@example.bz`, ['passengers.moderate']);
    const mc = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: moderator.email, password: moderator.password }));
    expect((await patch(mc, `admin/passengers/providers/${testOp.profileId}/test-mode`, { isTest: true })).status).toBe(200);
    const testDep = await makeDeparture(testOp, 2000);

    // Two real-side services, both visible first so each later refusal fails
    // for its own reason and not a broken fixture.
    const opA = await makeProvider('Test Dormant Route Lines');
    const depA = await makeDeparture(opA, 2000);
    const opB = await makeProvider('Test Suspended Discovery');
    const depB = await makeDeparture(opB, 2000);
    const rider = await registerUser(`pb_neg_${uniq()}@example.com`);
    const before = await get(rider.cookies, 'passenger/services');
    expect(before.body.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([depA.routeId, depB.routeId]));
    expect((await get(rider.cookies, `passenger/departures/${depA.tripId}`)).status).toBe(200);
    expect((await get(rider.cookies, `passenger/departures/${depB.tripId}`)).status).toBe(200);

    // The other side of the boundary: not listed, and not readable by id.
    expect(before.body.map((s: { id: string }) => s.id)).not.toContain(testDep.routeId);
    expect((await get(rider.cookies, `passenger/departures/${testDep.tripId}`)).status).toBe(404);

    // A route the operator retired disappears from both answers.
    expect((await patch(opA.cookies, `passenger/provider/routes/${depA.routeId}`, { isActive: false })).status).toBe(200);
    // A suspended operator's services go with them. Raw write by necessity —
    // no product path can suspend an operator (the S2 review's F5, open).
    await ctx.prisma.passengerProviderProfile.update({ where: { id: opB.profileId }, data: { isActive: false } });

    const afterIds = (await get(rider.cookies, 'passenger/services')).body.map((s: { id: string }) => s.id);
    expect(afterIds).not.toContain(depA.routeId);
    expect(afterIds).not.toContain(depB.routeId);
    expect((await get(rider.cookies, `passenger/departures/${depA.tripId}`)).status).toBe(404);
    expect((await get(rider.cookies, `passenger/departures/${depB.tripId}`)).status).toBe(404);

    // An unknown id is exactly as unknown as a hidden one.
    expect((await get(rider.cookies, 'passenger/departures/nonexistent-departure-id')).status).toBe(404);
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
    const driver = await makeFleetDriver(op);
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

  it('a suspended operator publishes nothing either — S2 and S3 tell one suspension story', async () => {
    // QA finding F2: booking and staffing already honoured the flag; route and
    // departure PUBLISHING did not, because S2 predated the check. Same raw
    // isActive write as above — still the only way to suspend (F5, open).
    const op = await makeProvider('Test Silenced Lines');
    const { routeId } = await makeDeparture(op, 2000);
    await ctx.prisma.passengerProviderProfile.update({ where: { id: op.profileId }, data: { isActive: false } });

    const newRoute = await post(op.cookies, 'passenger/provider/routes', routeBody(2000));
    expect(newRoute.status).toBe(400);
    expect(newRoute.body.message).toMatch(/suspended/i);
    const newTrip = await post(op.cookies, 'passenger/provider/trips', { routeId, scheduledDepartureAt: TOMORROW().toISOString() });
    expect(newTrip.status).toBe(400);
    expect(newTrip.body.message).toMatch(/suspended/i);
    // Cleanup survives suspension: the existing departure can still be cancelled.
    const trips = await ctx.prisma.passengerTrip.findMany({ where: { routeId } });
    expect((await post(op.cookies, `passenger/provider/trips/${trips[0]!.id}/cancel`, { reason: 'Winding down.' })).status).toBe(201);
  });
});

/* ------------------------------------------------------------------------- */

describe('the admin assignable-vehicles picker asks the authority', () => {
  /** A driver-owned APPROVED vehicle, registered and moderated through the product. */
  async function makeDriverVehicle(driver: { cookies: string[] }) {
    const v = await post(driver.cookies, 'passenger/driver/vehicles', {
      type: 'CAR',
      make: 'Honda',
      model: 'CR-V',
      licencePlate: `PBD-${uniq()}`.slice(0, 18),
      seatCapacity: 4,
    });
    expect(v.status).toBe(201);
    expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
    return v.body.id as string;
  }

  const assignable = (tripId: string, cookies: string[] = admin) =>
    get(cookies, `admin/passengers/trips/${tripId}/assignable-vehicles`);

  it("lists the operator fleet and an eligible fleet driver's own vehicle — and assign accepts a listed one", async () => {
    const op = await makeProvider('Test Picker Lines');
    const driver = await makeFleetDriver(op);
    const fleetVehicleId = await makeFleetVehicle(op, 12);
    const ownVehicleId = await makeDriverVehicle(driver);
    const { tripId } = await makeDeparture(op, 2500);

    const r = await assignable(tripId);
    expect(r.status).toBe(200);
    const byId = new Map(r.body.map((v: { id: string }) => [v.id, v]));
    const fleetRow = byId.get(fleetVehicleId) as { ownership: string; usableByDriverProfileId: string | null } | undefined;
    const ownRow = byId.get(ownVehicleId) as { ownership: string; usableByDriverProfileId: string | null; usableByDriverName: string | null } | undefined;
    expect(fleetRow).toBeDefined();
    expect(fleetRow!.ownership).toBe('FLEET');
    expect(fleetRow!.usableByDriverProfileId).toBeNull();
    expect(ownRow).toBeDefined();
    expect(ownRow!.ownership).toBe('DRIVER');
    expect(ownRow!.usableByDriverProfileId).toBe(driver.driverProfileId);
    expect(ownRow!.usableByDriverName).not.toBeNull();

    // The contract that keeps listing and assign in lockstep: a listed vehicle
    // is one assign ACCEPTS.
    expect((await post(admin, `admin/passengers/trips/${tripId}/assign`, {
      driverProfileId: driver.driverProfileId, vehicleId: fleetVehicleId,
    })).status).toBe(201);
  });

  it('REFUSES the unrelated operator, both ways: never listed, and assign rejects it too', async () => {
    const op = await makeProvider('Test Picker Lines A');
    const rival = await makeProvider('Test Picker Lines B');
    const driver = await makeFleetDriver(op);
    await makeFleetVehicle(op, 12);
    const rivalVehicleId = await makeFleetVehicle(rival, 14);
    const { tripId } = await makeDeparture(op, 2500);

    const r = await assignable(tripId);
    expect(r.status).toBe(200);
    expect(r.body.some((v: { id: string }) => v.id === rivalVehicleId)).toBe(false);

    // The other half of the lockstep contract: an unlisted vehicle is one
    // assign REFUSES.
    const denied = await post(admin, `admin/passengers/trips/${tripId}/assign`, {
      driverProfileId: driver.driverProfileId, vehicleId: rivalVehicleId,
    });
    expect(denied.status).toBe(400);
    expect(denied.body.message).toMatch(/operator's vehicles|assigned driver's own/i);
  });

  it('a vehicle still awaiting moderation never appears', async () => {
    const op = await makeProvider('Test Picker Pending Lines');
    await makeFleetDriver(op);
    const pending = await post(op.cookies, 'passenger/provider/vehicles', {
      type: 'VAN', make: 'Toyota', model: 'Hiace',
      licencePlate: `PBP-${uniq()}`.slice(0, 18), seatCapacity: 12,
    });
    expect(pending.status).toBe(201); // deliberately NOT approved
    const { tripId } = await makeDeparture(op, 2500);

    const r = await assignable(tripId);
    expect(r.status).toBe(200);
    expect(r.body.some((v: { id: string }) => v.id === pending.body.id)).toBe(false);
  });

  it("an unaffiliated driver's own vehicle never appears — their vehicle travels only with them", async () => {
    const op = await makeProvider('Test Picker Solo Lines');
    await makeFleetDriver(op);
    const { tripId } = await makeDeparture(op, 2500);

    // A driving-ready independent: approved role, approved vehicle, NO affiliation.
    const solo = await registerUser(`pb_solo_${uniq()}@example.com`);
    await approveRole(solo.userId, 'PASSENGER_DRIVER');
    const prof = await put(solo.cookies, 'passenger/driver/profile', {
      legalName: 'Solo Driver', displayName: `PBSolo${uniq()}`, phone: '+5016100001',
      homeDistrict: 'TOLEDO', licenceNumber: `PBSL-${uniq()}`,
      licenceExpiry: TOMORROW().toISOString(), termsAccepted: true,
    });
    expect(prof.status).toBe(200);
    const soloVehicleId = await makeDriverVehicle(solo);

    const r = await assignable(tripId);
    expect(r.status).toBe(200);
    expect(r.body.some((v: { id: string }) => v.id === soloVehicleId)).toBe(false);
  });

  it('a fleet driver riding this very departure cannot lend it their vehicle', async () => {
    const op = await makeProvider('Test Picker Riding Lines');
    const driver = await makeFleetDriver(op);
    const fleetVehicleId = await makeFleetVehicle(op, 12);
    const ownVehicleId = await makeDriverVehicle(driver);
    const { tripId } = await makeDeparture(op, 2500);

    // The driver books a seat on the departure they might have staffed.
    expect((await post(driver.cookies, 'passenger/bookings', { tripId, seats: 1 })).status).toBe(201);

    const r = await assignable(tripId);
    expect(r.status).toBe(200);
    const ids = r.body.map((v: { id: string }) => v.id);
    expect(ids).toContain(fleetVehicleId); // the fleet itself is unaffected
    expect(ids).not.toContain(ownVehicleId); // assign would refuse this pairing
  });

  it('answers only for a departure that can still be assigned', async () => {
    const op = await makeProvider('Test Picker Staffed Lines');
    const driver = await makeFleetDriver(op);
    const vehicleId = await makeFleetVehicle(op, 12);
    const { tripId } = await makeDeparture(op, 2500);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    const r = await assignable(tripId);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/scheduled departure/i);
  });

  it('sits under the assign permission: read-only admins are refused', async () => {
    const op = await makeProvider('Test Picker Permission Lines');
    await makeFleetVehicle(op, 12);
    const { tripId } = await makeDeparture(op, 2500);

    const reader = await seedLimitedAdmin(ctx.prisma, `pb_reader_${uniq()}@example.com`, ['passengers.read']);
    const readerCookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: reader.email, password: reader.password }));
    expect((await assignable(tripId, readerCookies)).status).toBe(403);

    const moderator = await seedLimitedAdmin(ctx.prisma, `pb_mod_${uniq()}@example.com`, ['passengers.moderate']);
    const modCookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: moderator.email, password: moderator.password }));
    expect((await assignable(tripId, modCookies)).status).toBe(200);
  });
});
