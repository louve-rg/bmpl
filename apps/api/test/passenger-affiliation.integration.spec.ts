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
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
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
  return { ...u, profileId: prof.body.id as string, businessName };
}

/** An approved, INDEPENDENT driver — no affiliation of any kind. */
async function makeDriver() {
  const u = await registerUser(`af_drv_${uniq()}@example.com`);
  await approveRole(u.userId, 'PASSENGER_DRIVER');
  const displayName = `AFDrv${uniq()}`;
  const prof = await put(u.cookies, 'passenger/driver/profile', {
    legalName: 'Alex Fleet',
    displayName,
    phone: '+5016200000',
    homeDistrict: 'TOLEDO',
    licenceNumber: `AFDL-${uniq()}`,
    licenceExpiry: TOMORROW().toISOString(),
    termsAccepted: true,
  });
  expect(prof.status).toBe(200);
  return { ...u, driverProfileId: prof.body.id as string, displayName };
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

  it('admin can see every affiliation — who, which side asked, and its current state — but still cannot act for a party (MDF-553 gap 1)', async () => {
    const op = await makeProvider('Test Oversight Lines');
    const otherOp = await makeProvider('Test Oversight Bystander');
    const drv = await makeDriver();

    const invite = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId, message: 'Join us.' });
    expect(invite.status).toBe(201);

    const reader = await seedLimitedAdmin(ctx.prisma, `af_admr_${uniq()}@example.bz`, ['passengers.read']);
    const rc = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: reader.email, password: reader.password }));

    // Before this gap closed, the only admin-visible trace of this PENDING
    // ask was nothing — getDriver shows CURRENT membership, and this ask
    // has not been answered yet, so there is no membership to show.
    const pending = await get(rc, `admin/passengers/affiliations?driverProfileId=${drv.driverProfileId}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      id: invite.body.id,
      status: 'PENDING',
      initiatedBy: 'PROVIDER',
      message: 'Join us.',
      driver: { id: drv.driverProfileId },
      provider: { id: op.profileId, businessName: 'Test Oversight Lines' },
    });

    // No permission, no view — passengers.read gates this the same as its siblings.
    const noPerm = await seedLimitedAdmin(ctx.prisma, `af_admnp_${uniq()}@example.bz`, ['passengers.moderate']);
    const npc = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: noPerm.email, password: noPerm.password }));
    expect((await get(npc, 'admin/passengers/affiliations')).status).toBe(403);

    // Filters narrow correctly: the bystander operator's id finds nothing.
    expect((await get(rc, `admin/passengers/affiliations?providerProfileId=${otherOp.profileId}`)).body).toHaveLength(0);

    // The driver answers (admin cannot — proven generally above, this read
    // view gives it nothing to act through anyway). The SAME row updates in
    // place: admin sees the history, not a second entry.
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(201);
    const accepted = await get(rc, `admin/passengers/affiliations?driverProfileId=${drv.driverProfileId}`);
    expect(accepted.body).toHaveLength(1);
    expect(accepted.body[0]).toMatchObject({ id: invite.body.id, status: 'ACCEPTED' });
    expect(accepted.body[0].acceptedAt).toBeTruthy();
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(400); // already settled
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

    // The same death when the boundary moves on the OPERATOR's side instead.
    const op2 = await makeProvider('Test Boundary Lines Two');
    const drv2 = await makeDriver();
    const invite2 = await post(op2.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv2.driverProfileId });
    expect(invite2.status).toBe(201);
    expect((await patch(admin, `admin/passengers/providers/${op2.profileId}/test-mode`, { isTest: true })).status).toBe(200);
    const lateAccept2 = await post(drv2.cookies, `passenger/driver/affiliations/${invite2.body.id}/accept`);
    expect(lateAccept2.status).toBe(400);
    expect(lateAccept2.body.message).toMatch(/test boundary/i);
    expect(await pointerOf(drv2.driverProfileId)).toBeNull();
  });

  it('the database itself refuses twin pending asks — the invariant is structural, not advisory', async () => {
    const op = await makeProvider('Test Structural Lines');
    const drv = await makeDriver();
    expect((await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId })).status).toBe(201);
    // Raw on purpose, uniquely in this suite: this test attacks the
    // CONSTRAINT, not the service. A second PENDING for the same pair
    // written PAST the API — the state two racing asks would produce —
    // must be refused by Postgres itself (the partial unique index of
    // migration 20261104093000), not merely by the service's pre-check.
    await expect(
      ctx.prisma.passengerFleetAffiliation.create({
        data: { providerProfileId: op.profileId, driverProfileId: drv.driverProfileId, initiatedBy: 'DRIVER', status: 'PENDING' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Settled rows repeat freely — only the unanswered ask is unique.
    const declined = await post(drv.cookies, `passenger/driver/affiliations/${(await get(op.cookies, 'passenger/provider/affiliations')).body[0].id}/decline`);
    expect(declined.status).toBe(201);
    expect((await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId })).status).toBe(201);
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

/**
 * Discovery — the front door onto the asks above (MDF-COURIER).
 * Neither side could find a counterparty without already holding its raw
 * profile id; these two reads fix that without touching the write side at
 * all. The cases mirrored here are the exact ones `invite`/`request` already
 * refuse on write — proven as list EXCLUSIONS, not merely asserted, so a
 * directory result is never a dead end the next call would reject.
 */
describe('discovery directory', () => {
  it('an operator finds an eligible independent driver by partial name, and a driver finds an eligible operator the same way', async () => {
    const op = await makeProvider(`Test Discoverable Lines ${uniq()}`);
    const drv = await makeDriver();

    // Both sides can see each other BEFORE either asks — neither has a
    // pending/accepted affiliation yet, so no exclusion applies.
    const forOperator = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(drv.displayName.slice(0, -2))}`);
    expect(forOperator.status).toBe(200);
    expect(forOperator.body).toContainEqual(
      expect.objectContaining({ id: drv.driverProfileId, displayName: drv.displayName, isActive: true }),
    );
    const forDriver = await get(drv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(op.businessName.slice(0, 10))}`);
    expect(forDriver.status).toBe(200);
    expect(forDriver.body).toContainEqual(expect.objectContaining({ id: op.profileId, businessName: op.businessName, isActive: true }));

    // No raw id was ever typed to find it — handle === the same id the
    // write side already accepts, carried straight through.
    const foundDriver = forOperator.body.find((d: { id: string }) => d.id === drv.driverProfileId);
    expect((await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: foundDriver.id })).status).toBe(201);
  });

  it('q is required with a minimum of 2 characters, enforced server-side — not merely in the UI', async () => {
    const op = await makeProvider('Test Shortquery Lines');
    const drv = await makeDriver();

    expect((await get(op.cookies, 'passenger/provider/affiliations/directory/drivers')).status).toBe(400);
    expect((await get(op.cookies, 'passenger/provider/affiliations/directory/drivers?q=a')).status).toBe(400);
    expect((await get(op.cookies, 'passenger/provider/affiliations/directory/drivers?q=%20%20')).status).toBe(400);

    expect((await get(drv.cookies, 'passenger/driver/affiliations/directory/providers')).status).toBe(400);
    expect((await get(drv.cookies, 'passenger/driver/affiliations/directory/providers?q=a')).status).toBe(400);
  });

  it('a driver already in a fleet is excluded from an operator search — inviting one would 400 anyway', async () => {
    const homeFleet = await makeProvider(`Test Homefleet Lines ${uniq()}`);
    const drv = await makeDriver();
    const invite = await post(homeFleet.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect((await post(drv.cookies, `passenger/driver/affiliations/${invite.body.id}/accept`)).status).toBe(201);
    expect(await pointerOf(drv.driverProfileId)).toBe(homeFleet.profileId);

    const suitor = await makeProvider(`Test Suitor Lines ${uniq()}`);
    const found = await get(suitor.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(drv.displayName.slice(0, -2))}`);
    expect(found.status).toBe(200);
    expect(found.body).not.toContainEqual(expect.objectContaining({ id: drv.driverProfileId }));
    // The exclusion and the write-side refusal agree: inviting the same
    // driver the directory just hid would 400 for the identical reason.
    const blocked = await post(suitor.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/already drives for a fleet/i);
  });

  it('a driver this operator already invited is excluded from that operator\'s own search — inviting again would 400 anyway (MDF-502 follow-up)', async () => {
    // Closes the asymmetry: the driver-search exclusion above already
    // hides an operator the driver is awaiting; this is its mirror on the
    // operator side, so an operator is never shown a driver a second
    // invite would immediately refuse.
    const op = await makeProvider(`Test AlreadyInvited Lines ${uniq()}`);
    const drv = await makeDriver();
    expect((await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId })).status).toBe(201);

    const found = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(drv.displayName.slice(0, -2))}`);
    expect(found.status).toBe(200);
    expect(found.body).not.toContainEqual(expect.objectContaining({ id: drv.driverProfileId }));
    // The exclusion and the write-side refusal agree: inviting the same
    // driver the directory just hid would 400 for the identical reason.
    const blocked = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/already awaiting/i);

    // A DIFFERENT operator, with no ask of their own outstanding, still
    // finds the same driver — the exclusion is scoped to THIS caller's own
    // pending ask, not a blanket "ever invited by anyone" hide.
    const other = await makeProvider(`Test AlreadyInvited Lines Two ${uniq()}`);
    const foundByOther = await get(other.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(drv.displayName.slice(0, -2))}`);
    expect(foundByOther.body).toContainEqual(expect.objectContaining({ id: drv.driverProfileId }));
  });

  it('an operator already awaiting this driver\'s answer is excluded from that driver\'s own search — requesting again would 400 anyway', async () => {
    const op = await makeProvider(`Test Awaiting Lines ${uniq()}`);
    const drv = await makeDriver();
    expect((await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: drv.driverProfileId })).status).toBe(201);

    const found = await get(drv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(op.businessName.slice(0, 10))}`);
    expect(found.status).toBe(200);
    expect(found.body).not.toContainEqual(expect.objectContaining({ id: op.profileId }));
    // The exclusion and the write-side refusal agree: requesting the same
    // operator the directory just hid would 400 for the identical reason —
    // the driver should answer the existing invitation instead.
    const blocked = await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: op.profileId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/already awaiting/i);
  });

  it('the simulation boundary applies to discovery too — a test-mode counterparty never appears to a real one, or vice versa', async () => {
    const op = await makeProvider(`Test Boundary Discover Lines ${uniq()}`);
    const testDrv = await makeDriver();
    expect((await patch(admin, `admin/passengers/drivers/${testDrv.driverProfileId}/test-mode`, { isTest: true })).status).toBe(200);

    // A real operator never finds the test-mode driver…
    const forRealOperator = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(testDrv.displayName.slice(0, -2))}`);
    expect(forRealOperator.status).toBe(200);
    expect(forRealOperator.body).not.toContainEqual(expect.objectContaining({ id: testDrv.driverProfileId }));

    // …and the same test-mode driver never finds a real operator, either.
    const forTestDriver = await get(testDrv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(op.businessName.slice(0, 10))}`);
    expect(forTestDriver.status).toBe(200);
    expect(forTestDriver.body).not.toContainEqual(expect.objectContaining({ id: op.profileId }));
  });

  /**
   * MDF-502 follow-up coverage — the four gaps named as unverified when the
   * directory endpoints landed (d8f9953f): the role guard on the read routes
   * themselves, the ownership check proven rather than assumed from the
   * helper, non-APPROVED/inactive counterparties as a disclosure risk (not
   * merely a correctness nuance), and the unauthenticated query shape.
   */

  it('the role guard applies to the directory routes themselves, not just the write actions', async () => {
    const drv = await makeDriver();
    const op = await makeProvider(`Test Roleguard Lines ${uniq()}`);

    // A driver-only account holds no PASSENGER_PROVIDER role: the
    // provider-side directory is gated the same as every write route on that
    // controller — this had never been exercised for a GET before.
    const wrongSide = await get(drv.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent('anyone')}`);
    expect(wrongSide.status).toBe(403);
    const wrongSide2 = await get(op.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent('anyone')}`);
    expect(wrongSide2.status).toBe(403);

    // Unauthenticated: 401 before any role or ownership check runs at all.
    const anon = await request(ctx.server).get('/api/passenger/provider/affiliations/directory/drivers?q=anyone');
    expect(anon.status).toBe(401);
  });

  it('the ownership check is on the session, not a client-suppliable id — proven, not assumed from the helper', async () => {
    const drv = await makeDriver();
    const opA = await makeProvider(`Test OwnershipA Lines ${uniq()}`);
    const opB = await makeProvider(`Test OwnershipB Lines ${uniq()}`);

    // drv is already awaiting opA's own answer to drv's own request, so
    // drv's own search must exclude opA — but opB has no ask outstanding
    // with drv at all (the exclusion this mirrors: 'an operator already
    // awaiting this driver's answer is excluded from that driver's own
    // search', above — here attacked from the ownership-proof angle).
    expect((await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: opA.profileId })).status).toBe(201);

    const plain = await get(drv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(opA.businessName.slice(0, 10))}`);
    expect(plain.status).toBe(200);
    expect(plain.body).not.toContainEqual(expect.objectContaining({ id: opA.profileId }));

    // Smuggling opB's id (or a stray userId) alongside q changes nothing: the
    // schema strips unknown keys and the service only ever reads identity off
    // the authenticated session (ownDriverOrThrow(userId)). If it read an id
    // off the query instead, this call would start returning opA as
    // available (opB has no pending ask with drv) instead of excluding it.
    const smuggled = await get(
      drv.cookies,
      `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(opA.businessName.slice(0, 10))}&providerProfileId=${opB.profileId}&userId=${opB.userId}`,
    );
    expect(smuggled.status).toBe(200);
    expect(smuggled.body).toEqual(plain.body);
    expect(smuggled.body).not.toContainEqual(expect.objectContaining({ id: opA.profileId }));
  });

  it('a not-yet-approved role is excluded from the directory, in both directions — a leak here would disclose who applied', async () => {
    const op = await makeProvider(`Test Pendingrole Lines ${uniq()}`);
    const pendingDrv = await makeDriver();
    // Demote the role back to PENDING after makeDriver's own approval — the
    // profile exists, as it would mid-application, but is not yet
    // operational and must not be discoverable as if it were.
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: pendingDrv.userId, roleCode: 'PASSENGER_DRIVER' } },
      data: { status: 'PENDING' },
    });
    const forOperator = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(pendingDrv.displayName.slice(0, -2))}`);
    expect(forOperator.status).toBe(200);
    expect(forOperator.body).not.toContainEqual(expect.objectContaining({ id: pendingDrv.driverProfileId }));
    // The exclusion and the write-side refusal agree, exactly like every
    // other exclusion in this suite.
    const blocked = await post(op.cookies, 'passenger/provider/affiliations/invite', { driverProfileId: pendingDrv.driverProfileId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/not approved/i);

    const drv = await makeDriver();
    const pendingOp = await makeProvider(`Test Pendingrole Lines Two ${uniq()}`);
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: pendingOp.userId, roleCode: 'PASSENGER_PROVIDER' } },
      data: { status: 'PENDING' },
    });
    const forDriver = await get(drv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(pendingOp.businessName.slice(0, 10))}`);
    expect(forDriver.status).toBe(200);
    expect(forDriver.body).not.toContainEqual(expect.objectContaining({ id: pendingOp.profileId }));
    const blocked2 = await post(drv.cookies, 'passenger/driver/affiliations/request', { providerProfileId: pendingOp.profileId });
    expect(blocked2.status).toBe(400);
    expect(blocked2.body.message).toMatch(/not approved/i);
  });

  it('an inactive counterparty is excluded from the directory, in both directions', async () => {
    const op = await makeProvider(`Test Inactive Lines ${uniq()}`);
    const inactiveDrv = await makeDriver();
    await ctx.prisma.passengerDriverProfile.update({ where: { id: inactiveDrv.driverProfileId }, data: { isActive: false } });
    const forOperator = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(inactiveDrv.displayName.slice(0, -2))}`);
    expect(forOperator.status).toBe(200);
    expect(forOperator.body).not.toContainEqual(expect.objectContaining({ id: inactiveDrv.driverProfileId }));

    const drv = await makeDriver();
    const inactiveOp = await makeProvider(`Test Inactive Lines Two ${uniq()}`);
    await ctx.prisma.passengerProviderProfile.update({ where: { id: inactiveOp.profileId }, data: { isActive: false } });
    const forDriver = await get(drv.cookies, `passenger/driver/affiliations/directory/providers?q=${encodeURIComponent(inactiveOp.businessName.slice(0, 10))}`);
    expect(forDriver.status).toBe(200);
    expect(forDriver.body).not.toContainEqual(expect.objectContaining({ id: inactiveOp.profileId }));
  });

  it('the query length ceiling and the 25-result cap are enforced server-side, not merely in the UI (MDF-502)', async () => {
    const op = await makeProvider(`Test Capacity Lines ${uniq()}`);
    const over = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${'a'.repeat(121)}`);
    expect(over.status).toBe(400);
    const atMax = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${'a'.repeat(120)}`);
    expect(atMax.status).not.toBe(400);

    // 26 independent, eligible drivers sharing one findable token — every one
    // of them is a legitimate match, so the cap must hold on its own, not by
    // coincidence of a thin result set.
    const token = `Capline${uniq()}`;
    for (let i = 0; i < 26; i += 1) {
      const u = await registerUser(`af_cap_${uniq()}@example.com`);
      await approveRole(u.userId, 'PASSENGER_DRIVER');
      const r = await put(u.cookies, 'passenger/driver/profile', {
        legalName: 'Cap Line',
        displayName: `${token}-${i}`,
        phone: '+5016200001',
        homeDistrict: 'TOLEDO',
        licenceNumber: `CAPDL-${uniq()}`,
        licenceExpiry: TOMORROW().toISOString(),
        termsAccepted: true,
      });
      expect(r.status).toBe(200);
    }
    const capped = await get(op.cookies, `passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(token)}`);
    expect(capped.status).toBe(200);
    expect(capped.body.length).toBeLessThanOrEqual(25);
  });
});
