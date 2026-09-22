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
