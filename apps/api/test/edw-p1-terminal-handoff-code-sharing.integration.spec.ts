/**
 * EDW-P1/P2 (owner ruling, 2026-11-26): the root cause of Edward's reported
 * blocker — a shipment arrives at its destination terminal and never becomes
 * eligible for onward dispatch, and admin cannot assign a driver manually
 * either.
 *
 * ROOT CAUSE: `completeLeg` (shipment.service.ts) verifies a leg's PIN
 * against that SAME leg's own `handoffPin` column. Before this change, every
 * leg — including a LINE_HAUL leg — was seeded with an INDEPENDENTLY random
 * code at creation (`legData`, `this.genPin()`). A third-party Terminal
 * Company's own staff (the role a receiving terminal necessarily uses, per
 * `TerminalLegsController`'s own doc comment: "neither `@RequirePermission`
 * nor `@Roles`") have no API-reachable way to learn that independent
 * LINE_HAUL code: the only two reveal paths are BML-internal admin
 * (`logistics.verify`, `GET admin/logistics/legs/:id/handoff-pin`) and the
 * route's own carrier/provider org (`revealCarrierHandoffCode`) — neither is
 * a Terminal Company's own axis. A receiving terminal could mark a leg
 * ARRIVED (no PIN required there) but could never COMPLETE the handoff, so
 * `releaseNext`/`offerNewlyReadyCourierLeg` never ran and the onward leg
 * stayed PENDING — also explaining why manual admin assignment correctly
 * refused it (`isLegActionable` requires the prior leg COMPLETED, not merely
 * arrived).
 *
 * THE FIX (shipment.service.ts, `legRows`/`legData`): when a LINE_HAUL leg's
 * `originHubId` is the immediately-preceding leg's `destinationHubId`, and
 * that preceding leg is FIRST_MILE, the LINE_HAUL leg is seeded with THAT
 * SAME `handoffPin` value instead of an independent one. This is "the same
 * code is recorded on the physical package" made literal: the courier
 * presents it at the departure terminal to complete the FIRST_MILE leg, and
 * the receiving terminal enters that exact value to complete the LINE_HAUL
 * leg — no new endpoint, no new verification path, no widened reveal. Each
 * leg keeps its own independent `handoffPinAttempts` lockout.
 *
 * SAFEGUARD -> TEST MAP:
 * - shared at creation, not incidental            -> 'is seeded with the identical handoffPin...'
 * - the actual bug, fixed end to end              -> 'the code a courier presents at the departure terminal...'
 * - wrong-code attempts restricted independently  -> 'a wrong code at the receiving terminal is refused...'
 * - unrelated terminal cannot receive/redirect     -> 'staff at an unrelated terminal cannot use the shared code...'
 * - cannot register arrival/handoff before departure -> "the receiving terminal still cannot complete a handoff before the leg has arrived"
 * - no duplicate custody/records on reuse          -> 'repeating the correct code against an already-completed leg...'
 * - cannot authorise unrelated collection/pickup/delivery -> 'the shared code never collides with...'
 * - scope limit: no FIRST_MILE predecessor         -> 'a LINE_HAUL leg with no preceding FIRST_MILE keeps its own independent code'
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** A driver eligible for the BELIZE district — mirrors
 *  transport-leg-operations.integration.spec.ts's own `makeDriver`. Used
 *  only to prove Edward's SECOND reported symptom (manual admin assignment
 *  refused) is actually fixed once the onward leg is genuinely READY. */
async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`tdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'T Driver',
      displayName: `Tdr${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `TDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR', make: 'Toyota', model: 'Hilux',
      licencePlate: `TL-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}
const assignManually = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** A fresh two-hub water-taxi network, unique per call — Edward's own shape. */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const originCity = `SP ${tag}`;
  const destinationCity = `BC ${tag}`;
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `San Pedro Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: originCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1500,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Belize City Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: destinationCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  });
  expect(route.status).toBe(201);
  return { originHubId: origin.body.id as string, destinationHubId: destination.body.id as string, originCity, destinationCity };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'EDW-P1/P2 test fixture.' });
  return cookies;
}

async function bookDoorToDoor(cookies: string[], net: { originCity: string; destinationCity: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

/** Starts at the ORIGIN hub itself (sender drops off in person) — no courier,
 *  so no FIRST_MILE leg exists for a LINE_HAUL leg to inherit a code from. */
async function bookHubToDoor(cookies: string[], net: { originHubId: string; destinationCity: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'HUB_TO_DOOR',
    origin: { hubId: net.originHubId, name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function legRow(legId: string) {
  return ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
}
const custodyCount = (shipmentId: string) => ctx.prisma.custodyEvent.count({ where: { shipmentId } });

/** A FIRST_MILE leg must reach IN_PROGRESS before any handoff can complete
 *  ("that leg has not started") — ordinarily the assigned courier's own
 *  accept/pickup/in-transit/arriving sequence, which is Kelly's dispatch
 *  domain (apps/api/src/dispatch/**), not this card's. No driver is ever
 *  assigned in these fixtures, so `start` is the same driver-less shortcut
 *  terminal-queue.integration.spec.ts's own `completeFirstMileAsAdmin` uses —
 *  TERM-7 already allows a code-only completion with no assignee. This is
 *  not what's under test here; the shared-code HANDOFF itself, just below,
 *  is run through the terminal staff route to match Edward's real shape. */
async function startFirstMile(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/start`, {})).status).toBe(201);
}

async function makeTerminalStaff(hubIds: string[]) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`staff_${s}@example.com`);
  const company = await ctx.prisma.terminalCompanyProfile.create({
    data: { businessName: `Reef Terminals ${s}`, contactEmail: `reef_${s}@example.com`, isActive: true, isTest: false },
  });
  const member = await ctx.prisma.terminalCompanyMember.create({
    data: { terminalCompanyId: company.id, userId, memberRole: 'OPERATOR', status: 'ACTIVE' },
  });
  for (const hubId of hubIds) {
    const location = await ctx.prisma.terminalCompanyLocation.create({ data: { terminalCompanyId: company.id, hubId, isActive: true } });
    await ctx.prisma.terminalCompanyMemberLocation.create({ data: { memberId: member.id, locationId: location.id } });
  }
  return { cookies, userId };
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

describe('EDW-P1/P2: a chained FIRST_MILE -> LINE_HAUL pair shares one handoff code', () => {
  it('is seeded with the identical handoffPin at booking — before anyone touches either leg', async () => {
    const net = await makeNetwork();
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const lastMile = rows.find((l) => l.kind === 'LAST_MILE')!;

    expect(firstMile.handoffPin).not.toBeNull();
    expect(lineHaul.handoffPin).toBe(firstMile.handoffPin);

    // Each leg still keeps its OWN pickupPin and its OWN attempts counter —
    // sharing is scoped to exactly the one handoffPin pairing, nothing else.
    expect(firstMile.pickupPin).not.toBe(lineHaul.pickupPin);
    expect(firstMile.handoffPinAttempts).toBe(0);
    expect(lineHaul.handoffPinAttempts).toBe(0);
    // And the shared value never collides with the OTHER end of the chain —
    // the recipient's own LAST_MILE delivery code stays independently random.
    expect(lastMile.handoffPin).not.toBe(firstMile.handoffPin);
  });

  it('the code a courier presents at the departure terminal is the exact code the receiving terminal enters to release the onward leg — Edward\'s actual bug, fixed end to end, as terminal staff rather than admin', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const lastMile = rows.find((l) => l.kind === 'LAST_MILE')!;

    // The code is read ONCE, off the leg that first carries it — never
    // re-queried for the receiving terminal's step, to prove it is genuinely
    // the SAME value crossing the chain, not two independently-correct ones.
    const theCode = (await legRow(firstMile.id)).handoffPin!;

    // Origin terminal: courier presents the code, staff receive the parcel.
    await startFirstMile(firstMile.id);
    expect((await post(originStaff.cookies, `terminal/legs/${firstMile.id}/handoff`, { pin: theCode, receivedByName: 'SP Counter' })).status).toBe(
      201,
    );
    expect((await legRow(lineHaul.id)).status).toBe('READY');

    // The parcel travels.
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' })).status).toBe(201);
    expect((await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`)).status).toBe(201);

    // Before the fix, this is exactly where Edward's shipment got stuck: the
    // destination terminal had no way to learn a correct LINE_HAUL code at
    // all. Here, the SAME code travels with the parcel and completes it.
    const handoff = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'BZ Counter' });
    expect(handoff.status).toBe(201);

    // And the onward leg is now genuinely dispatchable — released the moment
    // the handoff committed, not merely marked arrived.
    const released = await legRow(lastMile.id);
    expect(released.status).toBe('READY');

    // Edward's SECOND reported symptom: admin could not assign a driver
    // manually either. Before this fix, this failed for the right reason
    // (isLegActionable — the prior leg was never COMPLETED) but failed all
    // the same. Proven fixed, not merely asserted: a real driver, really
    // assigned, through the real admin endpoint.
    const driver = await makeDriver();
    const manualAssign = await assignManually(lastMile.id, driver);
    expect(manualAssign.status).toBe(201);
    expect((await legRow(lastMile.id)).assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('a wrong code at the receiving terminal is refused, and counted against the LINE_HAUL leg\'s own counter — independently of the FIRST_MILE leg\'s', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const theCode = (await legRow(firstMile.id)).handoffPin!;
    const wrongCode = theCode === '0000' ? '1111' : '0000';

    await startFirstMile(firstMile.id);
    expect((await post(originStaff.cookies, `terminal/legs/${firstMile.id}/handoff`, { pin: theCode, receivedByName: 'SP Counter' })).status).toBe(
      201,
    );
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' })).status).toBe(201);
    expect((await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`)).status).toBe(201);

    const wrong = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: wrongCode, receivedByName: 'BZ Counter' });
    expect(wrong.status).toBe(400);
    expect((await legRow(lineHaul.id)).handoffPinAttempts).toBe(1);
    // FIRST_MILE already completed its own counter stays at 0 — the two legs
    // never share a lockout, only the one code value at creation.
    expect((await legRow(firstMile.id)).handoffPinAttempts).toBe(0);

    const right = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'BZ Counter' });
    expect(right.status).toBe(201);
  });

  it('staff at an unrelated terminal cannot use the shared code to receive or redirect the shipment', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const unrelatedStaff = await makeTerminalStaff([]); // granted no hub at all
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const theCode = (await legRow(firstMile.id)).handoffPin!;

    await startFirstMile(firstMile.id);
    expect((await post(originStaff.cookies, `terminal/legs/${firstMile.id}/handoff`, { pin: theCode, receivedByName: 'SP Counter' })).status).toBe(
      201,
    );
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' })).status).toBe(201);

    // The CORRECT code, from staff with no grant at either hub: refused on
    // location alone — a correct code never substitutes for being the right
    // terminal. Refused before arrival even registers (403, not 400/404).
    expect((await post(unrelatedStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`)).status).toBe(403);
    expect((await post(unrelatedStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'Someone else' })).status).toBe(
      403,
    );
    expect((await legRow(lineHaul.id)).status).toBe('IN_PROGRESS');
    expect((await legRow(lineHaul.id)).arrivedAt).toBeNull();
  });

  it('the receiving terminal still cannot complete the handoff before the leg has genuinely arrived (TERM-10, confirmed under a shared code)', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const theCode = (await legRow(firstMile.id)).handoffPin!;

    await startFirstMile(firstMile.id);
    expect((await post(originStaff.cookies, `terminal/legs/${firstMile.id}/handoff`, { pin: theCode, receivedByName: 'SP Counter' })).status).toBe(
      201,
    );
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' })).status).toBe(201);

    // Departed, not yet arrived: even the CORRECT shared code is refused.
    const early = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'BZ Counter' });
    expect(early.status).toBe(400);
    expect((await legRow(lineHaul.id)).status).toBe('IN_PROGRESS');
  });

  it('repeating the correct code against an already-completed LINE_HAUL leg does not duplicate custody or re-fire release', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const theCode = (await legRow(firstMile.id)).handoffPin!;

    await startFirstMile(firstMile.id);
    expect((await post(originStaff.cookies, `terminal/legs/${firstMile.id}/handoff`, { pin: theCode, receivedByName: 'SP Counter' })).status).toBe(
      201,
    );
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' })).status).toBe(201);
    expect((await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    expect((await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'BZ Counter' })).status).toBe(201);

    const countAfterFirst = await custodyCount(s.id);
    const repeat = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: theCode, receivedByName: 'BZ Counter again' });
    expect(repeat.status).toBe(400);
    expect(await custodyCount(s.id)).toBe(countAfterFirst);
  });

  it('the shared code never collides with the shipment\'s collectionPin or either leg\'s pickupPin — it cannot authorise unrelated collection or courier pickup', async () => {
    const net = await makeNetwork();
    const s = await bookDoorToDoor(await fundedSender(), net);
    const rows = await legsOf(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id } });
    const theCode = firstMile.handoffPin!;

    expect(theCode).not.toBe(shipment.collectionPin);
    expect(theCode).not.toBe(firstMile.pickupPin);
    expect(theCode).not.toBe(lineHaul.pickupPin);
  });

  it('a LINE_HAUL leg with no preceding FIRST_MILE (the sender dropped off at the hub in person) keeps its own independent code', async () => {
    const net = await makeNetwork();
    const s = await bookHubToDoor(await fundedSender(), { originHubId: net.originHubId, destinationCity: net.destinationCity });
    const rows = await legsOf(s.id);
    expect(rows.find((l) => l.kind === 'FIRST_MILE')).toBeUndefined();
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    expect(lineHaul.sequence).toBe(1);
    expect(lineHaul.handoffPin).not.toBeNull();
  });
});
