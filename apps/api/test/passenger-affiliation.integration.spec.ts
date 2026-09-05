/**
 * Fleet affiliation — MUTUAL CONSENT (BMPL-39), against real Postgres.
 *
 * The owner's rule, which this suite exists to attack: neither party may
 * unilaterally create an active affiliation. An operator may INVITE and a
 * driver may REQUEST, but only the OTHER side's answer activates the link —
 * and the link (PassengerDriverProfile.providerProfileId) is what the
 * own-fleet assignment rule reads, so every claim here is proven against
 * staffing a real departure, not just against a status field.
 *
 * Attacked doors: the initiator answering their own ask; a stranger answering
 * someone else's; request-body smuggling of the pointer; a second fleet
 * accepting an already-affiliated driver; stale asks surviving a test-mode
 * flip; and the admin surface (which deliberately has NO path that creates or
 * activates an affiliation — moderation can look, not consent).
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
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'A', lastName: 'F', acceptedTerms: true });
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
  const u = await registerUser(`af_op_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_PROVIDER');
  const prof = await put(u.cookies, 'passenger/provider/profile', { businessName, contactEmail: 'ops@example.com' });
  expect(prof.status).toBe(200);
  return { ...u, profileId: prof.body.id as string };
}

/** An approved, INDEPENDENT driver — no affiliation of any kind. */
async function makeDriver() {
  const u = await registerUser(`af_drv_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_DRIVER');
  const prof = await put(u.cookies, 'passenger/driver/profile', {
    legalName: 'Alex Fleet',
    displayName: `AFDrv${uniq()}`,
    phone: '+5016200000',
    homeDistrict: 'TOLEDO',
    licenceNumber: `AFDL-${uniq()}`,
    licenceExpiry: TOMORROW().toISOString(),
    termsAccepted: true,
  });
  expect(prof.status).toBe(200);
  return { ...u, driverProfileId: prof.body.id as string };
}

/** The operational proof: whether this driver can staff this fleet's departure. */
async function makeDeparture(operator: { cookies: string[] }) {
  const route = await post(operator.cookies, 'passenger/provider/routes', {
    name: `Test Affiliation Run ${uniq()}`,
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

async function makeFleetVehicle(operator: { cookies: string[] }) {
  const v = await post(operator.cookies, 'passenger/provider/vehicles', {
    type: 'VAN',
    make: 'Toyota',
    model: 'Hiace',
    licencePlate: `AF-${uniq()}`.slice(0, 18),
    seatCapacity: 12,
  });
  expect(v.status).toBe(201);
  expect((await post(admin, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
  return v.body.id as string;
}

const pointerOf = async (driverProfileId: string) =>
  (await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { id: driverProfileId }, select: { providerProfileId: true } })).providerProfileId;

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
  await ctx.prisma.passengerFleetAffiliation.deleteMany();
  await ctx.prisma.passengerDriverProfile.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ------------------------------------------------------------------------- */

describe('mutual consent', () => {
  it('an invitation alone affiliates nobody — and only the driver can answer it', async () => {
    const op = await makeProvider('Test Consent Lines');
    const drv = await makeDriver();
    const tripId = await makeDeparture(op);
    const vehicleId = await makeFleetVehicle(op);

    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('PENDING');
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // The inviter answering their own invitation is the unilateral path.
    const selfAnswer = await post(op.cookies, `passenger/provider/affiliations/${invite.body.id}/approve`);
    expect(selfAnswer.status).toBe(400);
    expect(selfAnswer.body.message).toMatch(/only the driver can accept/i);

    // Half-consented means unstaffable: the operational rule refuses.
    const early = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: drv.driverProfileId, vehicleId });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/own fleet drivers/i);

    // The driver's consent completes it — and the departure is staffable
    // end to end through the product, which is the whole point of the card.
    const accept = await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`);
    expect(accept.status).toBe(201);
    expect(accept.body.status).toBe('ACCEPTED');
    expect(await pointerOf(drv.driverProfileId)).toBe(op.profileId);
    const staffed = await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: drv.driverProfileId, vehicleId });
    expect(staffed.status).toBe(201);
    expect(staffed.body.status).toBe('ASSIGNED');

    // What was consented to is SEE-able where it is act-able: the driver's
    // own profile names the fleet, by identity a person can recognise.
    const me = await get(drv.cookies, 'passenger/driver/profile');
    expect(me.status).toBe(200);
    expect(me.body.providerProfileId).toBe(op.profileId);
    expect(me.body.provider).toMatchObject({ id: op.profileId, businessName: 'Test Consent Lines' });
  });

  it('a request alone affiliates nobody — and only the operator can answer it', async () => {
    const op = await makeProvider('Test Approval Lines');
    const drv = await makeDriver();

    const req = await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('PENDING');
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    const selfAnswer = await post(drv.cookies, `passenger/driver/affiliations/${req.body.id}/accept`);
    expect(selfAnswer.status).toBe(400);
    expect(selfAnswer.body.message).toMatch(/operator must approve/i);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    const approve = await post(op.cookies, `passenger/provider/affiliations/${req.body.id}/approve`);
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('ACCEPTED');
    expect(await pointerOf(drv.driverProfileId)).toBe(op.profileId);
  });

  it('a stranger cannot answer, end or even see someone else\'s affiliation', async () => {
    const op = await makeProvider('Test Party Lines');
    const otherOp = await makeProvider('Test Bystander Lines');
    const drv = await makeDriver();
    const otherDrv = await makeDriver();

    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(invite.status).toBe(201);

    // Not a party to the row: byte-for-byte Not Found, never a 400 that
    // confirms the row exists.
    for (const [cookies, path] of [
      [otherOp.cookies, `passenger/provider/affiliations/${invite.body.id}/approve`],
      [otherOp.cookies, `passenger/provider/affiliations/${invite.body.id}/decline`],
      [otherOp.cookies, `passenger/provider/affiliations/${invite.body.id}/end`],
      [otherDrv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`],
      [otherDrv.cookies, `passenger/driver/affiliations/${invite.body.id}/decline`],
      [otherDrv.cookies, `passenger/driver/affiliations/${invite.body.id}/end`],
    ] as const) {
      const r = await post(cookies as string[], path as string);
      expect(r.status).toBe(404);
    }
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // And a rider with no passenger role at all is refused at the door —
    // as is an ADMIN: consent authorizes on the second party's own userId,
    // and no admin credential substitutes for it (the self-delivery
    // precedent: user id at every layer, never a role).
    const rider = await registerUser(`af_r_${uniq()}@example.com`);
    expect((await post(rider.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(403);
    expect((await get(rider.cookies, 'passenger/provider/affiliations')).status).toBe(403);
    expect((await post(admin, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(403);
    expect((await post(admin, `passenger/provider/affiliations/${invite.body.id}/approve`)).status).toBe(403);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();
  });

  it('two half-consents never stitch into one affiliation', async () => {
    // An invite and a request for the SAME pair must never coexist: the
    // second ask is refused, in both orders, so there is never a state where
    // each party consented only to their own half.
    const op = await makeProvider('Test Stitch Lines');
    const drv = await makeDriver();
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(invite.status).toBe(201);
    const crossed = await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
    expect(crossed.status).toBe(400);
    expect(crossed.body.message).toMatch(/already awaiting/i);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // The other order, on a fresh pair.
    const op2 = await makeProvider('Test Stitch Lines Two');
    const drv2 = await makeDriver();
    expect((await post(drv2.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op2.profileId })).status).toBe(201);
    const crossed2 = await post(op2.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv2.driverProfileId });
    expect(crossed2.status).toBe(400);
    expect(crossed2.body.message).toMatch(/already awaiting/i);
    expect(await pointerOf(drv2.driverProfileId)).toBeNull();

    // The refused side answers the EXISTING ask with the proper verb — that
    // is a whole consent to the same thing, and it completes normally.
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(201);
    expect(await pointerOf(drv.driverProfileId)).toBe(op.profileId);
  });

  it('no request body smuggles the link or the boundary flag', async () => {
    const op = await makeProvider('Test Contraband Lines');
    const drv = await makeDriver();

    // The profile surface has no affiliation field: contraband is stripped.
    const smuggled = await put(drv.cookies, 'passenger/driver/profile', {
      legalName: 'Alex Fleet',
      displayName: `AFDrv${uniq()}`,
      phone: '+5016200000',
      homeDistrict: 'TOLEDO',
      licenceNumber: `AFDL-${uniq()}`,
      licenceExpiry: TOMORROW().toISOString(),
      termsAccepted: true,
      providerProfileId: op.profileId,
      isTest: true,
    });
    expect(smuggled.status).toBe(200);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // Neither ask accepts a status of its own choosing.
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', {
      driverProfileId: drv.driverProfileId,
      status: 'ACCEPTED',
      isTest: true,
    });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('PENDING');
    expect(invite.body.isTest).toBe(false);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();
  });

  it('a driver is in at most one fleet, even when two asks race', async () => {
    const fleetA = await makeProvider('Test First Lines');
    const fleetB = await makeProvider('Test Second Lines');
    const drv = await makeDriver();

    // Both fleets ask while the driver is free — both PENDING is legitimate.
    const inviteA = await post(fleetA.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    const inviteB = await post(fleetB.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(inviteA.status).toBe(201);
    expect(inviteB.status).toBe(201);

    expect((await post(drv.cookies, `passenger/driver/affiliations/${inviteA.body.id}/accept`)).status).toBe(201);
    // The stale second ask can no longer be consented into a second fleet.
    const second = await post(drv.cookies, `passenger/driver/affiliations/${inviteB.body.id}/accept`);
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already drives for a fleet/i);
    expect(await pointerOf(drv.driverProfileId)).toBe(fleetA.profileId);

    // A fresh ask at an affiliated driver is refused up front, both directions.
    const late = await post(fleetB.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/already drives for a fleet/i);
    const lateReq = await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: fleetB.profileId });
    expect(lateReq.status).toBe(400);
    // And a duplicate of a still-pending ask is refused too.
    const drv2 = await makeDriver();
    expect((await post(fleetA.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv2.driverProfileId })).status).toBe(201);
    const dup = await post(fleetA.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv2.driverProfileId });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/already awaiting/i);
  });

  it('declining and withdrawing are attributed, and neither is the other', async () => {
    const op = await makeProvider('Test Refusal Lines');
    const drv = await makeDriver();

    // Driver declines an invitation; a later re-invite is a fresh row.
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    // The initiator cannot decline their own ask into a refusal statistic…
    const wrongVerb = await post(op.cookies, `passenger/provider/affiliations/${invite.body.id}/decline`);
    expect(wrongVerb.status).toBe(400);
    expect(wrongVerb.body.message).toMatch(/withdraw/i);
    // …and the counterparty cannot withdraw what they did not initiate.
    const wrongVerb2 = await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/withdraw`);
    expect(wrongVerb2.status).toBe(400);
    const declined = await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/decline`);
    expect(declined.status).toBe(201);
    expect(declined.body.status).toBe('DECLINED');
    expect(declined.body.endedBy).toBe('DRIVER');
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // History survives refusal: a new ask starts over rather than reviving.
    const again = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(again.status).toBe(201);
    const withdrawn = await post(op.cookies, `passenger/provider/affiliations/${again.body.id}/withdraw`);
    expect(withdrawn.status).toBe(201);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    // A settled row answers no further verbs.
    expect((await post(drv.cookies, `passenger/driver/affiliations/${again.body.id}/accept`)).status).toBe(400);
    expect((await post(drv.cookies, `passenger/driver/affiliations/${again.body.id}/decline`)).status).toBe(400);

    // Both refused rows remain, as history, on both sides' lists.
    const mine = await get(drv.cookies, 'passenger/driver/affiliations');
    expect(mine.status).toBe(200);
    expect(mine.body.map((a: { status: string }) => a.status).sort()).toEqual(['DECLINED', 'WITHDRAWN']);
  });

  it('termination is safe: new staffing refuses, existing departures are untouched, every step is audited', async () => {
    const op = await makeProvider('Test Parting Lines');
    const drv = await makeDriver();
    const tripId = await makeDeparture(op);
    const vehicleId = await makeFleetVehicle(op);

    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(201);
    expect((await post(op.cookies, `passenger/provider/trips/${tripId}/assign`, { driverProfileId: drv.driverProfileId, vehicleId })).status).toBe(201);

    // The operator removes the driver (either side may end; consent creates,
    // either party dissolves).
    const ended = await post(op.cookies, `passenger/provider/affiliations/${invite.body.id}/end`);
    expect(ended.status).toBe(201);
    expect(ended.body.status).toBe('ENDED');
    expect(ended.body.endedBy).toBe('PROVIDER');
    expect(await pointerOf(drv.driverProfileId)).toBeNull();

    // And the driver's own profile no longer names a fleet.
    const me = await get(drv.cookies, 'passenger/driver/profile');
    expect(me.body.providerProfileId).toBeNull();
    expect(me.body.provider).toBeNull();

    // The departure already staffed keeps its driver — the safe behaviour.
    const trip = await ctx.prisma.passengerTrip.findUniqueOrThrow({ where: { id: tripId }, select: { status: true, driverProfileId: true } });
    expect(trip.status).toBe('ASSIGNED');
    expect(trip.driverProfileId).toBe(drv.driverProfileId);

    // But NEW staffing refuses immediately.
    const tripTwo = await makeDeparture(op);
    const refused = await post(op.cookies, `passenger/provider/trips/${tripTwo}/assign`, { driverProfileId: drv.driverProfileId, vehicleId });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/own fleet drivers/i);

    // An ended row cannot be re-ended or re-accepted.
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/end`)).status).toBe(400);
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(400);

    // The whole lifecycle is in the audit trail: invited, accepted, ended.
    const audits = (await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_AFFILIATION_CHANGED' } })).filter(
      (x) => (x.newValue as { affiliationId?: string }).affiliationId === invite.body.id,
    );
    expect(audits.map((x) => (x.newValue as { event?: string }).event).sort()).toEqual(['accepted', 'ended', 'invited']);
  });
});

describe('the simulation boundary', () => {
  it('an ask never crosses the boundary, and a stale ask dies when the boundary moves', async () => {
    const op = await makeProvider('Test Boundary Lines');
    const testDrv = await makeDriver();
    expect((await patch(admin, `admin/passengers/drivers/${testDrv.driverProfileId}/test-mode`, { isTest: true })).status).toBe(200);

    // A real fleet cannot invite a simulation driver, or vice versa.
    const cross = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: testDrv.driverProfileId });
    expect(cross.status).toBe(400);
    expect(cross.body.message).toMatch(/test boundary/i);
    const crossReq = await post(testDrv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
    expect(crossReq.status).toBe(400);
    expect(crossReq.body.message).toMatch(/test boundary/i);

    // A PENDING ask created same-side dies if a flip moves the boundary
    // before consent: acceptance re-checks the live flags.
    const drv = await makeDriver();
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(invite.status).toBe(201);
    expect((await patch(admin, `admin/passengers/drivers/${drv.driverProfileId}/test-mode`, { isTest: true })).status).toBe(200);
    const lateAccept = await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`);
    expect(lateAccept.status).toBe(400);
    expect(lateAccept.body.message).toMatch(/test boundary/i);
    expect(await pointerOf(drv.driverProfileId)).toBeNull();
  });

  it('an ACCEPTED affiliation pins both test-mode flags — end it first', async () => {
    const op = await makeProvider('Test Pinned Lines');
    const drv = await makeDriver();
    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(201);

    const flipDriver = await patch(admin, `admin/passengers/drivers/${drv.driverProfileId}/test-mode`, { isTest: true });
    expect(flipDriver.status).toBe(400);
    expect(flipDriver.body.message).toMatch(/end the affiliation/i);
    const flipProvider = await patch(admin, `admin/passengers/providers/${op.profileId}/test-mode`, { isTest: true });
    expect(flipProvider.status).toBe(400);
    expect(flipProvider.body.message).toMatch(/end the affiliation/i);

    // Ending it releases both — the flip succeeds afterwards.
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/end`)).status).toBe(201);
    expect((await patch(admin, `admin/passengers/drivers/${drv.driverProfileId}/test-mode`, { isTest: true })).status).toBe(200);
  });
});
