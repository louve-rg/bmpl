/**
 * Who is told what, when people move — the passenger notification contract.
 *
 * BMPL-104 proved these emissions LAND (the operator's "New seat request" and
 * the rider's "Seats confirmed" both arrived during the live walkthrough), so
 * this file is not investigating the product — it is the assertion layer that
 * was missing (BMPL-105): nine emission sites, zero assertions, meaning a
 * future change could silently stop any of them and no test would notice.
 *
 * The charter, mirrored from shipping-notifications.integration.spec.ts:
 * every assertion is about EXACTLY the right person AND the substance of what
 * they are told. A count-only test passes when the message goes to the wrong
 * recipient or says the wrong thing — and a notification to the wrong person
 * is worse than none. So each test pins recipient, title, and the body facts
 * a human would act on (the reference they'd search, the reason they'd read,
 * the vehicle they'd look for).
 *
 * One rule holds everywhere: every notification goes to its ONE recipient
 * with no copies — an actor never gets an echo of their own action. A rider
 * self-cancel was originally pinned here as deliberate silence toward the
 * operator; BMPL-112 ended that (a freed seat is a fact the operator can act
 * on), and the two rider-cancel tests below assert the notification exactly
 * as this file's silence assertion once promised they would.
 *
 * The capture window is an ID DIFF around the step, copied from the shipping
 * suite: comparing row-id sets cannot skew the way clock comparisons do, and
 * scoping to the step is what makes "exactly one" a meaningful claim when a
 * fixture legitimately fires notifications of its own during setup.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const TOMORROW = () => new Date(Date.now() + 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

/* ------------------------------------------------------------- fixtures */

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
  const u = await registerUser(`pn_op_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_PROVIDER');
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string, businessName };
}

/** A driving-ready driver with NO fleet — so consent can happen inside a capture window. */
async function makeLoneDriver() {
  const u = await registerUser(`pn_drv_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_DRIVER');
  const prof = await put(u.cookies, 'passenger/driver/profile', {
    legalName: 'Pat Driver',
    displayName: `PNDrv${uniq()}`,
    phone: '+5016100000',
    homeDistrict: 'TOLEDO',
    licenceNumber: `PNDL-${uniq()}`,
    licenceExpiry: TOMORROW().toISOString(),
    termsAccepted: true,
  });
  expect(prof.status).toBe(200);
  return { ...u, driverProfileId: prof.body.id as string };
}

/** Fleet membership through the product (invite + accept), for tests past consent. */
async function joinFleet(operator: { cookies: string[] }, driver: { cookies: string[]; driverProfileId: string }) {
  const invite = await post(operator.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: driver.driverProfileId });
  expect(invite.status).toBe(201);
  const accepted = await post(driver.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`);
  expect(accepted.status).toBe(201);
  return invite.body.id as string;
}

async function makeFleetVehicle(operator: { cookies: string[] }, seatCapacity = 6) {
  const v = await post(operator.cookies, 'passenger/provider/vehicles', {
    type: 'VAN',
    make: 'Toyota',
    model: 'Hiace',
    licencePlate: `PN-${uniq()}`.slice(0, 18),
    seatCapacity,
  });
  expect(v.status).toBe(201);
  expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
  return v.body.id as string;
}

/** A priced departure on a fresh route, all through the API. */
async function makeDeparture(operator: { cookies: string[] }, routeName: string) {
  const route = await post(operator.cookies, 'passenger/provider/routes', {
    name: routeName,
    originDistrict: 'TOLEDO',
    originCity: 'Test Landing North',
    destinationDistrict: 'TOLEDO',
    destinationCity: 'Test Landing South',
    baseFareMinor: 500,
  });
  expect(route.status).toBe(201);
  const trip = await post(operator.cookies, 'passenger/provider/trips', {
    routeId: route.body.id,
    scheduledDepartureAt: TOMORROW().toISOString(),
  });
  expect(trip.status).toBe(201);
  return { routeId: route.body.id as string, tripId: trip.body.id as string, tripReference: trip.body.reference as string };
}

/* -------------------------------------------------- the capture window */

interface Delivered {
  title: string;
  body: string;
  userId: string;
  data: Record<string, unknown>;
}

async function capture(step: () => Promise<unknown>): Promise<Delivered[]> {
  const before = new Set(
    (await ctx.prisma.notificationRecipient.findMany({ select: { id: true } })).map((r) => r.id),
  );
  await step();
  const rows = (
    await ctx.prisma.notificationRecipient.findMany({ include: { notification: true }, orderBy: { id: 'asc' } })
  ).filter((r) => !before.has(r.id));
  return rows.map((r) => ({
    title: r.notification.title,
    body: r.notification.body,
    userId: r.userId,
    data: (r.notification.data ?? {}) as Record<string, unknown>,
  }));
}

/* ---------------------------------------------------------------- setup */

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
  await ctx.prisma.notificationRecipient.deleteMany();
  await ctx.prisma.notification.deleteMany();
  await ctx.prisma.passengerTripAssignment.deleteMany();
  await ctx.prisma.passengerBooking.deleteMany();
  await ctx.prisma.passengerTrip.deleteMany();
  await ctx.prisma.passengerVehicle.deleteMany();
  await ctx.prisma.passengerRouteStop.deleteMany();
  await ctx.prisma.passengerRoute.deleteMany();
  await ctx.prisma.passengerFleetAffiliation.deleteMany();
  await ctx.prisma.passengerDriverProfile.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ---------------------------------------------------------------- tests */

describe('booking notifications', () => {
  it('a seat request notifies the operator — exactly one, carrying seats, route and reference', async () => {
    const op = await makeProvider('Test Notify Lines');
    const routeName = `Test Notify Run ${uniq()}`;
    const { tripId, tripReference } = await makeDeparture(op, routeName);
    const rider = await registerUser(`pn_r1_${uniq()}@example.com`);

    const delivered = await capture(async () => {
      const r = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 2 });
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(op.userId); // the operator, and nobody else — not the rider
    expect(n.title).toBe('New seat request');
    expect(n.body).toContain('2 seat(s)');
    expect(n.body).toContain(routeName);
    expect(n.body).toContain(tripReference);
    expect(n.data.tripId).toBe(tripId);
  });

  it('confirmation notifies the rider — the reference and seat count they would check', async () => {
    const op = await makeProvider('Test Notify Lines');
    const { tripId } = await makeDeparture(op, `Test Notify Run ${uniq()}`);
    const driver = await makeLoneDriver();
    await joinFleet(op, driver);
    const vehicleId = await makeFleetVehicle(op);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    const rider = await registerUser(`pn_r2_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 2 });
    expect(booking.status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(op.cookies, `passenger/provider/bookings/${booking.body.id}/confirm`);
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(rider.userId);
    expect(n.title).toBe('Seats confirmed');
    expect(n.body).toContain(booking.body.reference);
    expect(n.body).toContain('2 seat(s)');
    expect(n.data.bookingId).toBe(booking.body.id);
  });

  it('an operator cancellation tells the rider, and carries the reason they will read', async () => {
    const op = await makeProvider('Test Notify Lines');
    const { tripId } = await makeDeparture(op, `Test Notify Run ${uniq()}`);
    const rider = await registerUser(`pn_r3_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(booking.status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(op.cookies, `passenger/provider/bookings/${booking.body.id}/cancel`, { reason: 'Vehicle out of service' });
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(rider.userId);
    expect(n.title).toBe('Booking cancelled');
    expect(n.body).toContain(booking.body.reference);
    expect(n.body).toContain('Vehicle out of service');
  });

  it('a rider withdrawing their own request notifies the operator — the silence that used to be here was deliberate, and BMPL-112 ended it', async () => {
    const op = await makeProvider('Test Notify Lines');
    const routeName = `Test Notify Run ${uniq()}`;
    const { tripId, tripReference } = await makeDeparture(op, routeName);
    const rider = await registerUser(`pn_r4_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 1 });
    expect(booking.status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(rider.cookies, `passenger/bookings/${booking.body.id}/cancel`);
      expect(r.status).toBe(201);
    });

    // This assertion was written as pinned SILENCE — "if that is ever decided,
    // this assertion is the one that changes" — and BMPL-112 decided it: the
    // operator now hears of rider cancellations, because a freed seat is a fact
    // they can act on. The rider still gets no self-echo, so the delta is
    // exactly one row. A withdrawn REQUEST held no seat, and the body says so.
    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(op.userId); // the operator — the rider gets no echo of their own action
    expect(n.title).toBe('Seat request withdrawn');
    expect(n.body).toContain(booking.body.reference);
    expect(n.body).toContain(routeName);
    expect(n.body).toContain(tripReference);
    expect(n.body).toContain('No seat was held');
    expect(n.data.tripId).toBe(tripId);
  });

  it('a rider cancelling a CONFIRMED booking tells the operator how many seats came back', async () => {
    const op = await makeProvider('Test Notify Lines');
    const routeName = `Test Notify Run ${uniq()}`;
    const { tripId, tripReference } = await makeDeparture(op, routeName);
    const driver = await makeLoneDriver();
    await joinFleet(op, driver);
    const vehicleId = await makeFleetVehicle(op);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId })).status).toBe(201);

    const rider = await registerUser(`pn_r5_${uniq()}@example.com`);
    const booking = await post(rider.cookies, 'passenger/bookings', { tripId, seats: 2 });
    expect(booking.status).toBe(201);
    expect((await post(op.cookies, `passenger/provider/bookings/${booking.body.id}/confirm`)).status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(rider.cookies, `passenger/bookings/${booking.body.id}/cancel`);
      expect(r.status).toBe(201);
    });

    // The commercially live case BMPL-112 was opened for: two held seats just
    // came free, and the operator can resell them only if they hear about it.
    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(op.userId);
    expect(n.title).toBe('Rider cancelled — seats freed');
    expect(n.body).toContain('2 seat(s) freed');
    expect(n.body).toContain(routeName);
    expect(n.body).toContain(tripReference);
    expect(n.body).toContain(booking.body.reference);
    expect(n.data.bookingId).toBe(booking.body.id);
  });

  it('staffing notifies the driver — naming the route and the vehicle they will look for', async () => {
    const op = await makeProvider('Test Notify Lines');
    const routeName = `Test Notify Run ${uniq()}`;
    const { tripId, tripReference } = await makeDeparture(op, routeName);
    const driver = await makeLoneDriver();
    await joinFleet(op, driver);
    const vehicleId = await makeFleetVehicle(op);

    const delivered = await capture(async () => {
      const r = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId });
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    const n = delivered[0]!;
    expect(n.userId).toBe(driver.userId); // the assigned driver — not the operator
    expect(n.title).toBe('You have a departure');
    expect(n.body).toContain(routeName);
    expect(n.body).toContain(tripReference);
    expect(n.body).toContain('Toyota Hiace');
    expect(n.data.tripId).toBe(tripId);
  });
});

describe('affiliation notifications — each consent step tells the party it is waiting on', () => {
  it('an invitation notifies the driver, naming the business that asked', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const driver = await makeLoneDriver();

    const delivered = await capture(async () => {
      const r = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: driver.driverProfileId });
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(driver.userId);
    expect(delivered[0]!.title).toBe('Fleet invitation');
    expect(delivered[0]!.body).toContain(op.businessName);
  });

  it('a join request notifies the operator', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const driver = await makeLoneDriver();

    const delivered = await capture(async () => {
      const r = await post(driver.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(op.userId);
    expect(delivered[0]!.title).toBe('Fleet join request');
  });

  it('acceptance notifies the party who was WAITING: driver accepts → operator hears', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const driver = await makeLoneDriver();
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: driver.driverProfileId });
    expect(invite.status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(driver.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`);
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(op.userId); // the inviter, not the actor
    expect(delivered[0]!.title).toBe('Fleet affiliation active');
  });

  it('approval notifies the party who was WAITING: operator approves → driver hears', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const driver = await makeLoneDriver();
    const ask = await post(driver.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
    expect(ask.status).toBe(201);

    const delivered = await capture(async () => {
      const r = await post(op.cookies, `passenger/provider/affiliations/${ask.body.id}/approve`);
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(driver.userId); // the requester, not the actor
    expect(delivered[0]!.title).toBe('Fleet affiliation active');
  });

  it('ending notifies the counterparty: driver leaves → operator hears', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const driver = await makeLoneDriver();
    const affiliationId = await joinFleet(op, driver);

    const delivered = await capture(async () => {
      const r = await post(driver.cookies, `passenger/driver/affiliations/${affiliationId}/end`);
      expect(r.status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(op.userId);
    expect(delivered[0]!.title).toBe('Fleet affiliation ended');
  });
});

describe('vehicle moderation notifications', () => {
  it('approval tells the owner which vehicle passed', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const v = await post(op.cookies, 'passenger/provider/vehicles', {
      type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: `PN-${uniq()}`.slice(0, 18), seatCapacity: 6,
    });
    expect(v.status).toBe(201);

    const delivered = await capture(async () => {
      expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(op.userId);
    expect(delivered[0]!.title).toBe('Vehicle approved');
    expect(delivered[0]!.body).toContain('Toyota Hiace');
    expect(delivered[0]!.data.vehicleId).toBe(v.body.id);
  });

  it('rejection tells the owner which vehicle failed, and why', async () => {
    const op = await makeProvider(`Test Fleet ${uniq()}`);
    const v = await post(op.cookies, 'passenger/provider/vehicles', {
      type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: `PN-${uniq()}`.slice(0, 18), seatCapacity: 6,
    });
    expect(v.status).toBe(201);

    const delivered = await capture(async () => {
      expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/reject`, { reason: 'Insurance document expired' })).status).toBe(201);
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.userId).toBe(op.userId);
    expect(delivered[0]!.title).toBe('Vehicle needs attention');
    expect(delivered[0]!.body).toContain('Toyota Hiace');
    expect(delivered[0]!.body).toContain('Insurance document expired');
  });
});
