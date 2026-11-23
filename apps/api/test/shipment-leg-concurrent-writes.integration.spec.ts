/**
 * SHIP-LEG-CONCURRENT-WRITES, against real Postgres.
 *
 * Stanley fired 3 simultaneous `POST admin/logistics/legs/:id/depart` at one
 * READY line-haul leg and got 3x 201: custody_events SENDER then HUB->CARRIER
 * three times, 3 SHIPMENT_LEG_DEPARTED audit rows, departedAt overwritten by
 * whichever request committed last. The cause: each of `startLeg`,
 * `confirmAndStartLeg`, `departLeg` and `arriveLeg` read the leg once inside
 * a READ COMMITTED transaction, checked a field on that stale read, then did
 * an UNCONDITIONAL `shipmentLeg.update` — no row lock, no conditional write,
 * so every concurrent reader that saw the same stale "not yet done" value
 * went ahead and committed its own write and its own side effects.
 *
 * The fix applies the same conditional-claim pattern `completeLeg` and
 * `flagException` already used for the identical class of race (MDF-223):
 * `shipmentLeg.updateMany` keyed on exactly the fields the guard above just
 * read, refusing (409) when the row no longer matches by the time the write
 * runs. The acceptance shape this suite proves for all five fixed methods:
 * concurrent callers produce exactly ONE winner, ONE custody row (where the
 * method appends one at all), ONE audit row, one terminal timestamp — and
 * every loser gets a real refusal, not a silent no-op that still looks like
 * success.
 *
 * A fifth method, `recordCollection` (SHIP-RECORDCOLLECTION-CONCURRENT),
 * carried the identical defect and was found after the other four already
 * merged — it is the worst of the five because it is the LAST step of a
 * parcel's life: 3 concurrent collects with the right code gave 3x 201,
 * 3 HUB->RECIPIENT custody rows and 3 SHIPMENT_LEG_HANDOFF audit rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedBaselineCourierCoverage, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

let hub: Record<string, string> = {};

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`cwdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Cwd${s}`,
      phone: '+5016000001',
      homeDistrict: 'BELIZE',
      licenceNumber: `CWD-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `CW-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'PLA', to: 'MUN', minutes: 45, price: 8000 },
    { from: 'MUN', to: 'SPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book() {
  const r = await post(customer, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });
async function pickupPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { pickupPin: true } })).pickupPin!;
}
const custodyCount = (legId: string) => ctx.prisma.custodyEvent.count({ where: { shipmentLegId: legId } });
const auditCount = (action: string, legId: string) =>
  ctx.prisma.auditLog.count({ where: { action: action as never, newValue: { path: ['legId'], equals: legId } } });
const custodyCountByShipment = (shipmentId: string) => ctx.prisma.custodyEvent.count({ where: { shipmentId } });
const auditCountByShipment = (action: string, shipmentId: string) =>
  ctx.prisma.auditLog.count({ where: { action: action as never, newValue: { path: ['shipmentId'], equals: shipmentId } } });

/** DOOR_TO_HUB: ends AT the destination hub, no LAST_MILE — the journey
 *  closes with recordCollection, never a door handoff. */
async function bookDoorToHub() {
  const r = await post(customer, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: hub.MUN, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'AIR',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function handoffPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}

/** Books a DOOR_TO_HUB shipment and admin-drives it all the way to
 *  AWAITING_COLLECTION — admin start+handoff for FIRST_MILE (no driver
 *  needed), admin depart+arrive+handoff for the one LINE_HAUL hop — same
 *  shape as terminal-collection-code-recipient.integration.spec.ts's own
 *  completeFirstMileAsAdmin/driveToAwaitingCollection. */
async function bookedAwaitingCollection() {
  const booked = await bookDoorToHub();
  const first = (await legs(booked.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await post(admin, `admin/logistics/legs/${first.id}/start`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${first.id}/handoff`, { pin: await handoffPinFor(first.id), receivedByName: 'Counter staff' })).status).toBe(201);
  const lineHaul = (await legs(booked.id)).find((l) => l.kind === 'LINE_HAUL')!;
  expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
  const done = await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: await handoffPinFor(lineHaul.id), receivedByName: 'Counter staff' });
  expect(done.status).toBe(201);
  expect(done.body.status).toBe('AWAITING_COLLECTION');
  return booked;
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
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`cwcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Concurrent-writes fixture.' });
  await disableDispatch();
  await seedNetwork();
  await seedBaselineCourierCoverage(ctx.prisma);
});

const N = 5;

describe('startLeg: concurrent admin starts on one READY, unassigned leg', () => {
  it('exactly one winner, one DRIVER custody row, one SHIPMENT_LEG_STARTED audit row, losers refuse', async () => {
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.assignedDriverProfileId).toBeNull();
    // Booking itself already wrote one custody row for this leg (null ->
    // SENDER, "the chain has no gap at its start") — startLeg must add
    // exactly one more, not zero (lost write) and not several (duplicate).
    const custodyBefore = await custodyCount(first.id);

    const responses = await Promise.all(Array.from({ length: N }, () => post(admin, `admin/logistics/legs/${first.id}/start`, {})));
    const wins = responses.filter((r) => r.status === 201);
    const losses = responses.filter((r) => r.status !== 201);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(N - 1);
    // Not a fixed refusal code for every loser (same lesson MDF-223's own
    // test states): a loser whose own transaction's read lands AFTER the
    // winner's commit sees the already-changed status and is refused by the
    // method's ordinary pre-check (400) instead of ever reaching the
    // conditional write's race (409). Both are real refusals; only a 201 is
    // the defect this suite exists to catch.
    for (const r of losses) expect([400, 409]).toContain(r.status);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(leg.status).toBe('IN_PROGRESS');
    expect(leg.startedAt).not.toBeNull();
    expect(await custodyCount(first.id)).toBe(custodyBefore + 1);
    expect(await auditCount('SHIPMENT_LEG_STARTED', first.id)).toBe(1);
  });
});

describe('confirmAndStartLeg: concurrent driver pickups with the correct PIN on one accepted leg', () => {
  it('exactly one winner, one DRIVER custody row, one SHIPMENT_LEG_STARTED audit row, losers refuse', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);
    const pin = await pickupPinFor(first.id);
    const custodyBefore = await custodyCount(first.id); // booking's own baseline row, see startLeg's test above

    const responses = await Promise.all(
      Array.from({ length: N }, () => post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`, { pin })),
    );
    const wins = responses.filter((r) => r.status === 201);
    const losses = responses.filter((r) => r.status !== 201);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(N - 1);
    // Not a fixed refusal code for every loser (same lesson MDF-223's own
    // test states): a loser whose own transaction's read lands AFTER the
    // winner's commit sees the already-changed status and is refused by the
    // method's ordinary pre-check (400) instead of ever reaching the
    // conditional write's race (409). Both are real refusals; only a 201 is
    // the defect this suite exists to catch.
    for (const r of losses) expect([400, 409]).toContain(r.status);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(leg.status).toBe('IN_PROGRESS');
    expect(leg.courierStatus).toBe('PICKUP_CONFIRMED');
    expect(await custodyCount(first.id)).toBe(custodyBefore + 1);
    expect(await auditCount('SHIPMENT_LEG_STARTED', first.id)).toBe(1);
  });
});

describe('departLeg: concurrent departures on one READY line-haul leg (Stanley\'s reproduction)', () => {
  it('exactly one winner, one HUB->CARRIER custody row, one SHIPMENT_LEG_DEPARTED audit row, one departedAt, losers refuse', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`, { pin: await pickupPinFor(first.id) })).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/in-transit`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/arriving`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/handoff`, {
      pin: (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id }, select: { handoffPin: true } })).handoffPin!,
      receivedByName: 'Counter staff',
    })).status).toBe(201);
    const haul = (await legs(s.id)).find((l) => l.kind === 'LINE_HAUL' && l.status === 'READY')!;
    // Nothing has been recorded against THIS leg's own id yet — the
    // first-mile handoff's custody row above is scoped to first.id, not
    // haul.id (appendCustody always keys on the completing leg's own id).
    const custodyBefore = await custodyCount(haul.id);
    expect(custodyBefore).toBe(0);

    const responses = await Promise.all(Array.from({ length: N }, () => post(admin, `admin/logistics/legs/${haul.id}/depart`, {})));
    const wins = responses.filter((r) => r.status === 201);
    const losses = responses.filter((r) => r.status !== 201);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(N - 1);
    // Not a fixed refusal code for every loser (same lesson MDF-223's own
    // test states): a loser whose own transaction's read lands AFTER the
    // winner's commit sees the already-changed status and is refused by the
    // method's ordinary pre-check (400) instead of ever reaching the
    // conditional write's race (409). Both are real refusals; only a 201 is
    // the defect this suite exists to catch.
    for (const r of losses) expect([400, 409]).toContain(r.status);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: haul.id } });
    expect(leg.status).toBe('IN_PROGRESS');
    expect(leg.departedAt).not.toBeNull();
    expect(await custodyCount(haul.id)).toBe(custodyBefore + 1);
    expect(await auditCount('SHIPMENT_LEG_DEPARTED', haul.id)).toBe(1);
  });
});

describe('arriveLeg: concurrent arrivals on one IN_PROGRESS line-haul leg (the one Stanley suspected)', () => {
  it('exactly one winner, no new custody row (arrival appends none), one SHIPMENT_LEG_ARRIVED audit row, one arrivedAt, losers refuse', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`, { pin: await pickupPinFor(first.id) })).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/in-transit`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/arriving`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/handoff`, {
      pin: (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id }, select: { handoffPin: true } })).handoffPin!,
      receivedByName: 'Counter staff',
    })).status).toBe(201);
    const haul = (await legs(s.id)).find((l) => l.kind === 'LINE_HAUL' && l.status === 'READY')!;
    expect((await post(admin, `admin/logistics/legs/${haul.id}/depart`, {})).status).toBe(201);
    const custodyBeforeArrive = await custodyCount(haul.id);

    const responses = await Promise.all(Array.from({ length: N }, () => post(admin, `admin/logistics/legs/${haul.id}/arrive`, {})));
    const wins = responses.filter((r) => r.status === 201);
    const losses = responses.filter((r) => r.status !== 201);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(N - 1);
    // Not a fixed refusal code for every loser (same lesson MDF-223's own
    // test states): a loser whose own transaction's read lands AFTER the
    // winner's commit sees the already-changed status and is refused by the
    // method's ordinary pre-check (400) instead of ever reaching the
    // conditional write's race (409). Both are real refusals; only a 201 is
    // the defect this suite exists to catch.
    for (const r of losses) expect([400, 409]).toContain(r.status);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: haul.id } });
    expect(leg.arrivedAt).not.toBeNull();
    expect(await custodyCount(haul.id)).toBe(custodyBeforeArrive); // unchanged — arrive appends none
    expect(await auditCount('SHIPMENT_LEG_ARRIVED', haul.id)).toBe(1);
  });
});

describe('recordCollection: concurrent collections on one AWAITING_COLLECTION shipment (SHIP-RECORDCOLLECTION-CONCURRENT)', () => {
  it('exactly one winner, one HUB->RECIPIENT custody row, one SHIPMENT_LEG_HANDOFF audit row, losers refuse — never 429', async () => {
    const booked = await bookedAwaitingCollection();
    const code = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } })).collectionPin!;
    const custodyBefore = await custodyCountByShipment(booked.id);
    // The fixture's own two admin handoffs (FIRST_MILE + LINE_HAUL) already
    // wrote their own SHIPMENT_LEG_HANDOFF rows via transition() before
    // collect() is ever called — the action name is reused, so the count
    // must be a delta against that baseline, not an absolute.
    const handoffAuditBefore = await auditCountByShipment('SHIPMENT_LEG_HANDOFF', booked.id);

    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        post(admin, `admin/logistics/shipments/${booked.id}/collect`, { collectedByName: 'Recipient', code }),
      ),
    );
    const wins = responses.filter((r) => r.status === 201);
    const losses = responses.filter((r) => r.status !== 201);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(N - 1);
    // Trap Stanley caught: a 429 is the rate limiter, not the conditional
    // claim — a test that only checked "the losers failed" would pass
    // against completely unguarded code if it happened to hit the
    // throttle instead. Assert the CODE, never 429.
    for (const r of losses) {
      expect(r.status).not.toBe(429);
      expect([400, 409]).toContain(r.status);
    }

    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id } });
    expect(shipment.collectedAt).not.toBeNull();
    expect(await custodyCountByShipment(booked.id)).toBe(custodyBefore + 1);
    expect(await auditCountByShipment('SHIPMENT_LEG_HANDOFF', booked.id)).toBe(handoffAuditBefore + 1);
  });
});
