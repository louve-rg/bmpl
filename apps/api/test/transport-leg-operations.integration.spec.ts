/**
 * Transport-leg (LINE_HAUL) operation — the untested corner Edward's UAT block
 * lives in (BMPL-138), against real Postgres.
 *
 * qa's BMPL-140 audit found the happy path covered by the journey walks but
 * ZERO negatives: nothing pinned what depart/arrive refuse, and nothing pinned
 * the permission they demand. This suite closes that corner, cause-independent
 * of whatever Edward's live rows turn out to say:
 *
 *  - depart refuses a courier leg, and a leg whose turn has not come;
 *  - arrive refuses a leg that is not in transit;
 *  - both refuse an admin holding logistics.read only (the limited-admin PAIR —
 *    a super-admin-only test proves nothing about the gate);
 *  - the full walk of Edward's journey shape (San Pedro -> Belize City over
 *    SEA) pins the release chain: prior handoff flips the LINE_HAUL
 *    PENDING -> READY, depart stamps departedAt and hands custody HUB ->
 *    CARRIER, arrive stamps arrivedAt, and the arrival handoff makes the
 *    LAST_MILE assignable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let readOnlyAdmin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
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

/** An approved, online driver with a vehicle, serving the Belize district. */
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

/** Edward's geography: two water-taxi terminals, one SEA route between them. */
async function seedWaterTaxiNetwork() {
  hub = {};
  for (const h of [
    { code: 'SPW', name: 'San Pedro Water Taxi Terminal', city: 'San Pedro', fee: 1500 },
    { code: 'BZW', name: 'Belize City Water Taxi Terminal', city: 'Belize City', fee: 1000 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: h.city, modes: ['LAND', 'SEA'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  expect((await post(admin, 'admin/logistics/routes', {
    originHubId: hub.SPW, destinationHubId: hub.BZW, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  })).status).toBe(201);
}

/** Manual dispatch, matching production. */
async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** Door to door across the water: courier -> water taxi -> courier. */
async function book() {
  const r = await post(customer, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: 'San Pedro', address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: 'Belize City', address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

/**
 * BMPL-348: `JSON.stringify(body)` then `.not.toContain(pin)` flattens the
 * whole document into one string first — and a flattened document has
 * substrings that exist in no actual value, manufactured across field
 * boundaries and punctuation. That is exactly how this assertion once
 * failed on real, correct code: a fixture phone number ending
 * `...2223333` collided with a CI run whose random PIN happened to be
 * `2223`, four digits sitting inside one field's value, not leaked from
 * anywhere. Walking the PARSED body and checking real leaf values avoids
 * both directions of the mistake:
 *
 * 1. Every leaf, compared to the PIN as a string, must not be an exact
 *    match — this is what actually does the work: it finds the PIN under a
 *    key nobody thought to name, and it catches one serialized as a NUMBER
 *    (`String(2223) === '2223'`), which a substring search on stringified
 *    JSON would miss (`2223` with no surrounding quotes never appears as a
 *    substring of `"2223"`).
 * 2. A string leaf must not contain the PIN as a STANDALONE TOKEN — bounded
 *    by a non-alphanumeric character (or the start/end of the string) on
 *    both sides — which is what preserves "your code is 2223" inside a
 *    notification body or an echoed error. A bare `\b` is not enough: it
 *    still fires inside a cuid like `cmuoid2223x`. `501-2223333` does not
 *    match because the run is followed by another digit; `cmuoid2223x`
 *    does not match because it is preceded by a letter.
 *
 * RESIDUAL, not pretended away: a prose field that legitimately contains a
 * standalone four-digit run equal to this run's real PIN would still fire.
 * Far rarer than an arbitrary digit run landing inside an unrelated field,
 * and when it fires it is at least pointing at something shaped like a
 * code — rule that out first if this ever goes red, rather than assuming
 * the assertion itself regressed.
 */
function findPinLeak(value: unknown, pin: string, path = '$'): string | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      const hit = findPinLeak(child, pin, `${path}.${key}`);
      if (hit) return hit;
    }
    return null;
  }
  if (String(value) === pin) return path;
  if (typeof value === 'string' && new RegExp(`(?<![0-9A-Za-z])${pin}(?![0-9A-Za-z])`).test(value)) return path;
  return null;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

/** A driver walks a courier leg from offer to handoff. */
async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/** Booked, with the first mile driven to the terminal: the LINE_HAUL's turn. */
async function bookedWithFirstMileDone(driver: Awaited<ReturnType<typeof makeDriver>>) {
  const s = await book();
  const rows = await legs(s.id);
  const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, driver)).status).toBe(201);
  await driveCourierLeg(driver, first.id);
  return { shipment: s, lineHaul: (await legs(s.id)).find((l) => l.kind === 'LINE_HAUL')! };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  // The PAIR for every permission assertion: an admin who can look but not act.
  const limited = await seedLimitedAdmin(ctx.prisma, `tro_readonly_${uniq()}@example.com`, ['logistics.read']);
  readOnlyAdmin = cookiesOf(
    await request(ctx.server).post('/api/auth/login').send({ email: limited.email, password: limited.password }),
  );
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
  const c = await registerUser(`tcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Transport-leg fixture.' });
  await disableDispatch();
  await seedWaterTaxiNetwork();
});

/* ------------------------------------------------------------------------- */

describe('what depart and arrive refuse', () => {
  it('depart refuses a courier leg — only a transport leg departs from a terminal', async () => {
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const r = await post(admin, `admin/logistics/legs/${first.id}/depart`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Only a transport leg');
  });

  it('depart refuses a transport leg whose turn has not come', async () => {
    const s = await book();
    const lineHaul = (await legs(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect(lineHaul.status).toBe('PENDING'); // the first mile has not moved
    const r = await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {});
    expect(r.status).toBe(400);
    // Sequence is authority: the refusal names the ordering, not a vague state.
    expect(r.body.message).toContain('has not reached this leg');
  });

  it('arrive refuses a leg that is not in transit', async () => {
    const driver = await makeDriver();
    const { lineHaul } = await bookedWithFirstMileDone(driver);
    expect(lineHaul.status).toBe('READY'); // ready, but it has not departed
    const r = await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('not in transit');
  });

  it('depart and arrive demand logistics.operate — logistics.read alone is refused', async () => {
    const driver = await makeDriver();
    const { lineHaul } = await bookedWithFirstMileDone(driver);
    // The leg is genuinely workable — so the ONLY thing refusing is the permission.
    expect(lineHaul.status).toBe('READY');
    expect((await post(readOnlyAdmin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(403);
    expect((await post(readOnlyAdmin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(403);
    // And the pair's other half: the operating admin is accepted.
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
  });
});

describe("Edward's journey shape: San Pedro -> Belize City by water taxi", () => {
  it('plans as courier -> SEA line-haul -> courier, and only the first mile is workable', async () => {
    const s = await book();
    const rows = await legs(s.id);
    expect(rows.map((l) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LAST_MILE']);
    expect(rows[1]!.mode).toBe('SEA');
    expect(rows.map((l) => l.status)).toEqual(['READY', 'PENDING', 'PENDING']);
  });

  it('the first-mile handoff releases the line-haul: PENDING -> READY', async () => {
    const driver = await makeDriver();
    const { lineHaul } = await bookedWithFirstMileDone(driver);
    // THE release regression. If this ever fails on a journey of this shape,
    // Edward's cause (a) is reproduced right here.
    expect(lineHaul.status).toBe('READY');
  });

  it('departs, arrives, hands off — and the last mile becomes assignable', async () => {
    const driver = await makeDriver();
    const { shipment, lineHaul } = await bookedWithFirstMileDone(driver);

    // Depart: stamps, custody, shipment status.
    const departed = await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {
      carrierName: 'UAT Water Taxi', carrierBookingRef: 'WT-07', note: 'On the 09:00 boat.',
    });
    expect(departed.status).toBe(201);
    let row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } });
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.departedAt).not.toBeNull();
    expect(row.carrierBookingRef).toBe('WT-07');
    const custody = await ctx.prisma.custodyEvent.findFirst({
      where: { shipmentLegId: lineHaul.id, toHolder: 'CARRIER' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(custody?.fromHolder).toBe('HUB');
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('IN_TRANSIT');

    // Arrive: the stamp, nothing completed yet.
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } });
    expect(row.arrivedAt).not.toBeNull();
    expect(row.status).toBe('IN_PROGRESS');

    // Handoff at the far terminal completes the leg and releases the last mile.
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, {
      pin: await pinOf(lineHaul.id), receivedByName: 'Desk BZW',
    })).status).toBe(201);
    const after = await legs(shipment.id);
    expect(after.find((l) => l.kind === 'LINE_HAUL')!.status).toBe('COMPLETED');
    const lastMile = after.find((l) => l.kind === 'LAST_MILE')!;
    expect(lastMile.status).toBe('READY');

    // "Assignable" proven by assigning: the manual path production actually uses.
    expect((await assign(lastMile.id, driver)).status).toBe(201);
  });
});

/**
 * Edward REQ 6: the complete chain, proven in one continuous walk rather than
 * as a set of individually-tested links. Sender -> FIRST_MILE courier ->
 * terminal -> LINE_HAUL carrier -> destination terminal -> LAST_MILE courier
 * -> recipient. "Collection" here means the recipient's own door handoff (the
 * LAST_MILE leg's completeLeg, toHolder RECIPIENT) — the chain this ticket
 * names ends at "recipient", not at a hub-side AWAITING_COLLECTION pickup
 * (that is `recordCollection`, a different ending for a different service
 * shape, exercised in shipping-collection.integration.spec.ts).
 *
 * At every real handoff: (a) a courier who is NOT the currently assigned one
 * is refused, (b) a wrong code is refused and counted against the same
 * lockout a wrong courier uses, (c) the custody trail gains exactly one row
 * per real transfer — none for a rejected attempt, (d) the raw code never
 * appears in a response that has no business holding it.
 */
describe('the complete chain, sender to recipient, every handoff proven (Edward REQ 6)', () => {
  const custodyCount = (shipmentId: string) => ctx.prisma.custodyEvent.count({ where: { shipmentId } });
  const custodyTrail = async (shipmentId: string) =>
    (await ctx.prisma.custodyEvent.findMany({ where: { shipmentId }, orderBy: { occurredAt: 'asc' } })).map((c) => ({
      from: c.fromHolder,
      to: c.toHolder,
    }));
  const attemptsOn = async (legId: string) =>
    (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPinAttempts: true } })).handoffPinAttempts;
  const otherPin = (real: string) => (real === '0000' ? '1111' : '0000');

  it('books, walks the full journey, and refuses every wrong courier and wrong code along the way', async () => {
    const driver1 = await makeDriver(); // first mile
    const bumped = await makeDriver(); // assigned to the last mile, then displaced
    const driver2 = await makeDriver(); // the courier who actually finishes it

    const s = await book();
    const rows = await legs(s.id);
    const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = rows.find((l) => l.kind === 'LINE_HAUL')!;
    const lastMile = rows.find((l) => l.kind === 'LAST_MILE')!;
    // Booking itself writes the chain's first row (null -> SENDER, "the sender
    // holds it until somebody collects it") — the chain has no gap at its
    // start, so the count begins at 1, not 0.
    expect(await custodyCount(s.id)).toBe(1);

    /* ---------------------------------------------------- FIRST_MILE leg */
    expect((await assign(firstMile.id, driver1)).status).toBe(201);

    // (a) A courier never offered this leg cannot touch it — 404, not 403, so
    // a stranger cannot even learn that a job exists there.
    expect((await post(bumped.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(404);
    expect((await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(bumped.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(404);
    expect((await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    // (c) Sender -> courier: exactly one NEW custody row, the moment it really happened.
    expect(await custodyCount(s.id)).toBe(2);

    expect((await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);

    const firstMilePin = await pinOf(firstMile.id);
    // (d) The courier who must PRODUCE this code never reads it off their own
    // screen — they have to be told it by the desk. Their own job view must
    // not carry it in any form.
    const ownJob = await request(ctx.server).get(`/api/driver/shipping-jobs/${firstMile.id}`).set('Cookie', driver1.cookies);
    expect(ownJob.status).toBe(200);
    expect(findPinLeak(ownJob.body, firstMilePin)).toBeNull();

    // The one legitimate way anyone reads it: staff deliberately reveal it.
    const revealed = await request(ctx.server).get(`/api/admin/logistics/legs/${firstMile.id}/handoff-pin`).set('Cookie', admin);
    expect(revealed.status).toBe(200);
    expect(revealed.body.handoffPin).toBe(firstMilePin);

    // (b) A wrong code: refused, and counted.
    expect(
      (await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: otherPin(firstMilePin), receivedByName: 'Desk' }))
        .status,
    ).toBe(400);
    expect(await attemptsOn(firstMile.id)).toBe(1);
    expect(await custodyCount(s.id)).toBe(2); // a rejected attempt moves nothing

    // (a) The right code, from someone who is NOT the assigned courier — here,
    // the desk itself trying to complete a courier's own leg on their behalf —
    // is ALSO refused, with the SAME message shape and the SAME shared
    // counter (BMPL-174): wrong-courier and wrong-code are one failure path on
    // purpose, so neither can be used to probe for the other.
    const staffAttempt = await post(admin, `admin/logistics/legs/${firstMile.id}/handoff`, { pin: firstMilePin, receivedByName: 'Desk' });
    expect(staffAttempt.status).toBe(400);
    expect(staffAttempt.body.message).toMatch(/not right/i);
    expect(await attemptsOn(firstMile.id)).toBe(2);
    expect(await custodyCount(s.id)).toBe(2);

    // The right code, from the actual currently-assigned courier: succeeds.
    expect(
      (await post(driver1.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: firstMilePin, receivedByName: 'Desk SPW' })).status,
    ).toBe(201);
    expect(await custodyCount(s.id)).toBe(3); // courier -> hub

    /* -------------------------------------------------------- LINE_HAUL leg */
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } })).status).toBe('READY');

    expect(
      (await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi', carrierBookingRef: 'WT-42' })).status,
    ).toBe(201);
    expect(await custodyCount(s.id)).toBe(4); // hub -> carrier

    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    expect(await custodyCount(s.id)).toBe(4); // arrival stamps only — custody has not moved yet

    const lineHaulPin = await pinOf(lineHaul.id);
    expect((await request(ctx.server).get(`/api/admin/logistics/legs/${lineHaul.id}/handoff-pin`).set('Cookie', admin)).body.handoffPin).toBe(
      lineHaulPin,
    );

    expect(
      (await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: otherPin(lineHaulPin), receivedByName: 'Desk BZW' })).status,
    ).toBe(400);
    expect(await attemptsOn(lineHaul.id)).toBe(1);
    expect(await custodyCount(s.id)).toBe(4);

    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: lineHaulPin, receivedByName: 'Desk BZW' })).status).toBe(
      201,
    );
    expect(await custodyCount(s.id)).toBe(5); // carrier -> hub

    /* --------------------------------------------------------- LAST_MILE leg */
    // Assigned, then genuinely REASSIGNED before the original courier ever
    // touches it — "currently assigned" has to be a live column, not a record
    // of who was first picked, or a legitimate reassignment would break.
    expect((await assign(lastMile.id, bumped)).status).toBe(201);
    expect(
      (
        await post(admin, `admin/logistics/legs/${lastMile.id}/reassign`, {
          driverProfileId: driver2.driverProfileId,
          vehicleId: driver2.vehicleId,
          reason: 'Original courier unavailable.',
        })
      ).status,
    ).toBe(201);

    // (a) The displaced courier — who really was assigned a moment ago — is
    // now refused, exactly like a stranger.
    expect((await post(bumped.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(404);
    // The newly assigned courier proceeds with no special case.
    expect((await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);
    expect((await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/pickup`)).status).toBe(201);
    expect(await custodyCount(s.id)).toBe(6); // hub -> courier
    expect((await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/in-transit`)).status).toBe(201);
    expect((await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/arriving`)).status).toBe(201);

    const lastMilePin = await pinOf(lastMile.id);
    // This is the ONE code the CUSTOMER legitimately holds — a LAST_MILE leg
    // ends at a door, not a desk, so the recipient's side is who must produce
    // it, and the sender's own view is where it has to appear.
    const customerView = await request(ctx.server).get(`/api/shipping/${s.reference}`).set('Cookie', customer);
    expect(customerView.body.legs.find((l: { id: string }) => l.id === lastMile.id).handoffPin).toBe(lastMilePin);

    // (d) Staff never see it listed (pinFor is null for STAFF unconditionally),
    // and there is nothing for them to deliberately reveal either — a
    // desk-reveal only ever applies to a code a DESK holds.
    const staffView = await request(ctx.server).get(`/api/admin/logistics/shipments/${s.reference}`).set('Cookie', admin);
    expect(staffView.body.legs.find((l: { id: string }) => l.id === lastMile.id).handoffPin).toBeNull();
    expect((await request(ctx.server).get(`/api/admin/logistics/legs/${lastMile.id}/handoff-pin`).set('Cookie', admin)).status).toBe(400);
    // And the anonymous public tracking link — reachable by anyone who has
    // ever seen the URL, proving nothing about who they are (owner ruling 12)
    // — never carries it, at the exact moment the code is live and real.
    const publicView = await request(ctx.server).get(`/api/shipping/track/${s.recipientTrackingToken}`);
    expect(publicView.status).toBe(200);
    expect(findPinLeak(publicView.body, lastMilePin)).toBeNull();

    // (b) Wrong code, refused and counted; then the right one, from the right
    // courier, completes the chain.
    expect(
      (await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/handoff`, { pin: otherPin(lastMilePin), receivedByName: 'Recipient' }))
        .status,
    ).toBe(400);
    expect(await attemptsOn(lastMile.id)).toBe(1);
    expect(await custodyCount(s.id)).toBe(6);

    expect(
      (await post(driver2.cookies, `driver/shipping-jobs/${lastMile.id}/handoff`, { pin: lastMilePin, receivedByName: 'Recipient' })).status,
    ).toBe(201);
    expect(await custodyCount(s.id)).toBe(7); // courier -> recipient: the parcel's actual collection

    // The whole trail, in order, exactly once each — "one row per real
    // transfer" proven positively, not merely "nothing looked wrong".
    expect(await custodyTrail(s.id)).toEqual([
      { from: null, to: 'SENDER' },
      { from: 'SENDER', to: 'DRIVER' },
      { from: 'DRIVER', to: 'HUB' },
      { from: 'HUB', to: 'CARRIER' },
      { from: 'CARRIER', to: 'HUB' },
      { from: 'HUB', to: 'DRIVER' },
      { from: 'DRIVER', to: 'RECIPIENT' },
    ]);

    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DELIVERED');
  });
});

/**
 * BMPL-138 classification: reproducing the exact symptom (a transport leg
 * that will not depart) under a condition that is genuinely DATA, not code —
 * a carrier-reported non-operating day (BMPL-196) — to test the hypothesis
 * directly rather than only by reasoning about it. The four production facts
 * Edward's own block is waiting on (his shipment reference, that leg's rows,
 * his account's grants, which screen he used) were never supplied and are not
 * reproduced here — nothing below stands in for them, and nothing here
 * invents a schedule for his real route. This only proves what the code does
 * when a route is genuinely configured NOT_OPERATING, so that fact can be
 * ruled in or out once someone can read his actual RouteOperatingDay /
 * RouteScheduleException rows.
 */
describe('BMPL-138 classification: a route configured NOT_OPERATING today refuses departure — data, not code', () => {
  it('refuses with the schedule reason, and departs again once the exception is gone', async () => {
    const driver = await makeDriver();
    const { lineHaul } = await bookedWithFirstMileDone(driver);
    const route = await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: lineHaul.routeId! } });

    const ex = await post(admin, `admin/logistics/routes/${route.id}/schedule/exceptions`, {
      date: new Date().toISOString(),
      status: 'NOT_OPERATING',
      reason: 'UAT: carrier reported no service today.',
    });
    expect(ex.status).toBe(201);

    const refused = await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {});
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('not operating today');
    expect(refused.body.message).toContain('UAT: carrier reported no service today.');
    // Refusing to depart must not silently move anything.
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } })).status).toBe('READY');

    // Not a permanent block: once the exception is gone (the real-world
    // equivalent of the carrier correcting or withdrawing the report), the
    // exact same leg departs with no other change anywhere.
    await ctx.prisma.routeScheduleException.deleteMany({ where: { routeId: route.id } });
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
  });
});
