/**
 * The way back out of a leg EXCEPTION, against real Postgres.
 *
 * The claim this suite exists to defend: AN EXCEPTION IS RECOVERABLE WITHOUT
 * LYING. Resuming restores exactly the state the leg was flagged from and
 * touches nothing else — not the driver, not the custody chain. Releasing a
 * driver is only possible while the parcel has not moved, because once it has,
 * "release" is not a state edit but a policy decision nobody has written, and
 * the endpoint must refuse rather than invent one.
 *
 * The second claim: cancellation and exception now compose. A shipment
 * cancelled while a leg sits in exception closes the driver's half of that leg
 * too — the phantom-job hole this branch fixes — and a customer cannot
 * self-cancel (and self-refund) a journey whose parcel is in a driver's hands
 * just because the flag renamed the leg's status.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
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

/** An approved, online driver with a vehicle, serving both fixture districts. */
async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`xdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Xrv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `XDL-${s}`,
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
      licencePlate: `XZ-${s}`.slice(0, 18),
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

/**
 * Automatic dispatch stays OFF in this suite, matching production: recovery's
 * re-queue is proven through the manual assignment path an operator actually
 * has, not through a sweeper production does not run.
 */
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

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

const flag = (legId: string, reason = 'Vehicle broke down at the pickup.') =>
  post(admin, `admin/logistics/legs/${legId}/exception`, { reason });

const resolve = (legId: string, body: object) => post(admin, `admin/logistics/legs/${legId}/resolve-exception`, body);

/** A driver walks a courier leg through every transition to the handoff. */
async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/** Book, manually assign the first mile, and return shipment + that leg. */
async function bookedWithAssignedFirstMile(driver: { driverProfileId: string; vehicleId: string }) {
  const s = await book();
  const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, driver)).status).toBe(201);
  return { shipment: s, legId: first.id };
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
  const c = await registerUser(`xcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Exception recovery fixture.' });
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('resume', () => {
  it('a not-yet-started leg resumes to READY with its driver intact', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);

    expect((await flag(legId)).status).toBe(201);
    let leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('EXCEPTION');
    let ship = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(ship.status).toBe('EXCEPTION');
    expect(ship.exceptionAt).not.toBeNull();

    const r = await resolve(legId, { resolution: 'RESUME', note: 'Replacement vehicle found; driver continuing.' });
    expect(r.status).toBe(201);

    leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('READY');
    expect(leg.exceptionAt).toBeNull();
    expect(leg.exceptionReason).toBeNull();
    // The same driver still holds the job — resuming is not a reassignment.
    expect(leg.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(leg.courierStatus).toBe('ASSIGNED');

    ship = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(ship.status).toBe('AWAITING_PICKUP');
    expect(ship.exceptionAt).toBeNull();
    expect(ship.exceptionReason).toBeNull();

    const audits = (await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_LEG_EXCEPTION_RESOLVED' } })).filter(
      (a) => (a.newValue as { legId?: string }).legId === legId,
    );
    expect(audits).toHaveLength(1);
    expect((audits[0]!.newValue as { resolution?: string }).resolution).toBe('RESUME');
    expect((audits[0]!.newValue as { restoredStatus?: string }).restoredStatus).toBe('READY');
  });

  it('a started leg resumes to IN_PROGRESS, the custody chain gains nothing, and the journey completes', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);

    const custodyBefore = await ctx.prisma.custodyEvent.count({ where: { shipmentId: shipment.id } });
    expect((await flag(legId, 'Road flooded outside Placencia.')).status).toBe(201);

    const r = await resolve(legId, { resolution: 'RESUME', note: 'Water receded; driver back on the road.' });
    expect(r.status).toBe(201);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('IN_PROGRESS');
    expect(leg.assignedDriverProfileId).toBe(driver.driverProfileId);
    // Nothing physically moved while the leg stood still: flagging and
    // resolving must leave the custody chain exactly as it was.
    expect(await ctx.prisma.custodyEvent.count({ where: { shipmentId: shipment.id } })).toBe(custodyBefore);

    // The driver's own transitions carry on as if nothing had been flagged.
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
    const done = await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
      pin: await pinOf(legId), receivedByName: 'Counter staff',
    });
    expect(done.status).toBe(201);
    const ship = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(ship.status).toBe('AT_ORIGIN_HUB');
  });

  it('a line-haul exception resumes and the operator continues to the handoff', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    await driveCourierLeg(driver, legId);

    const haul = (await legs(shipment.id)).find((l) => l.kind === 'LINE_HAUL' && l.status !== 'PENDING')!;
    expect((await post(admin, `admin/logistics/legs/${haul.id}/depart`, {})).status).toBe(201);
    expect((await flag(haul.id, 'Aircraft diverted by weather.')).status).toBe(201);

    const r = await resolve(haul.id, { resolution: 'RESUME', note: 'Flight resumed after the front passed.' });
    expect(r.status).toBe(201);
    const resumed = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: haul.id } });
    expect(resumed.status).toBe('IN_PROGRESS');

    expect((await post(admin, `admin/logistics/legs/${haul.id}/arrive`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${haul.id}/handoff`, {
      pin: await pinOf(haul.id), receivedByName: 'Counter staff',
    })).status).toBe(201);
  });
});

describe('release', () => {
  it('an uncollected leg releases its driver back to the pool and manual assignment restaffs it', async () => {
    const d1 = await makeDriver();
    const d2 = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(d1);
    expect((await post(d1.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);

    expect((await flag(legId, 'Driver reports engine failure before collecting.')).status).toBe(201);
    const r = await resolve(legId, { resolution: 'RELEASE_DRIVER', note: 'Driver cannot continue; re-queue the pickup.' });
    expect(r.status).toBe(201);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('READY');
    expect(leg.courierStatus).toBe('PENDING_ASSIGNMENT');
    expect(leg.assignedDriverProfileId).toBeNull();
    expect(leg.assignedVehicleId).toBeNull();
    expect(leg.acceptedAt).toBeNull();
    expect(leg.exceptionAt).toBeNull();

    // History closed, not erased: the released assignment survives as a row.
    const offers = await ctx.prisma.shipmentLegOffer.findMany({ where: { shipmentLegId: legId, driverProfileId: d1.driverProfileId } });
    expect(offers.length).toBeGreaterThanOrEqual(1);
    for (const o of offers) {
      expect(o.status).toBe('CANCELLED');
      expect(o.endedAt).not.toBeNull();
    }

    // The released driver's queue no longer contains the job.
    expect((await request(ctx.server).get(`/api/driver/shipping-jobs/${legId}`).set('Cookie', d1.cookies)).status).toBe(404);

    // The production restaffing path: an operator assigns the next driver.
    expect((await assign(legId, d2)).status).toBe(201);
    const restaffed = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(restaffed.assignedDriverProfileId).toBe(d2.driverProfileId);
    expect(restaffed.courierStatus).toBe('ASSIGNED');
    expect((await post(d2.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  });

  it('REFUSED once the driver has collected the parcel — the policy line', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
    expect((await flag(legId, 'Vehicle crashed en route.')).status).toBe(201);

    const r = await resolve(legId, { resolution: 'RELEASE_DRIVER', note: 'Trying to release mid-carry.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already collected/i);

    // Refusal means refusal: the exception stands and the driver still holds it.
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('EXCEPTION');
    expect(leg.assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('REFUSED when no driver holds the leg', async () => {
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await flag(first.id, 'Sender unreachable.')).status).toBe(201);
    const r = await resolve(first.id, { resolution: 'RELEASE_DRIVER', note: 'Nothing to release.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/No driver holds/i);
  });

  it('REFUSED on a transport leg — a carrier is not a driver', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    await driveCourierLeg(driver, legId);
    const haul = (await legs(shipment.id)).find((l) => l.kind === 'LINE_HAUL' && l.status === 'READY')!;
    expect((await flag(haul.id, 'Carrier no-show.')).status).toBe(201);

    const r = await resolve(haul.id, { resolution: 'RELEASE_DRIVER', note: 'Wrong tool for a carrier leg.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/carrier/i);
  });
});

describe('refusal shapes', () => {
  it('a leg that is not in exception has nothing to resolve, including one already resolved', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    const early = await resolve(legId, { resolution: 'RESUME', note: 'Nothing is wrong yet.' });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/not in exception/i);

    expect((await flag(legId)).status).toBe(201);
    expect((await resolve(legId, { resolution: 'RESUME', note: 'First resolution.' })).status).toBe(201);
    const again = await resolve(legId, { resolution: 'RESUME', note: 'Second resolution of the same flag.' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/not in exception/i);
  });

  it('resolving needs logistics.operate — reading the board is not enough', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    expect((await flag(legId)).status).toBe(201);

    const reader = await seedLimitedAdmin(ctx.prisma, `xreader_${uniq()}@example.com`, ['logistics.read']);
    const readerCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: reader.email, password: reader.password }),
    );
    expect((await post(readerCookies, `admin/logistics/legs/${legId}/resolve-exception`, {
      resolution: 'RESUME', note: 'Read-only admin trying to operate.',
    })).status).toBe(403);

    const operator = await seedLimitedAdmin(ctx.prisma, `xoperator_${uniq()}@example.com`, ['logistics.operate']);
    const operatorCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: operator.email, password: operator.password }),
    );
    expect((await post(operatorCookies, `admin/logistics/legs/${legId}/resolve-exception`, {
      resolution: 'RESUME', note: 'Operator resolving.',
    })).status).toBe(201);
  });
});

describe('cancellation with an exception on board', () => {
  it('staff cancellation closes the driver half of an exception leg — no phantom job survives', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
    expect((await flag(legId, 'Sender address does not exist.')).status).toBe(201);

    const r = await post(admin, `admin/logistics/shipments/${shipment.id}/cancel`, { reason: 'Unresolvable pickup address.' });
    expect(r.status).toBe(201);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('CANCELLED');
    expect(leg.courierStatus).toBe('CANCELLED');
    expect(leg.assignedDriverProfileId).toBeNull();
    const offers = await ctx.prisma.shipmentLegOffer.findMany({ where: { shipmentLegId: legId } });
    for (const o of offers) expect(['CANCELLED', 'REASSIGNED', 'DECLINED']).toContain(o.status);
    // The released driver cannot still see the job.
    expect((await request(ctx.server).get(`/api/driver/shipping-jobs/${legId}`).set('Cookie', driver.cookies)).status).toBe(404);
  });

  it('a customer cannot self-cancel a moving shipment because its leg was flagged', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
    expect((await flag(legId, 'Vehicle stuck; parcel on board.')).status).toBe(201);

    const r = await post(customer, `shipping/${shipment.id}/cancel`, { reason: 'Taking too long.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already moving/i);

    // Staff still can — support is exactly who the refusal points at.
    expect((await post(admin, `admin/logistics/shipments/${shipment.id}/cancel`, { reason: 'Support cancelling after exception.' })).status).toBe(201);
  });

  it('a customer CAN still cancel when the flagged leg never started — nothing has moved', async () => {
    const driver = await makeDriver();
    const { shipment, legId } = await bookedWithAssignedFirstMile(driver);
    expect((await flag(legId, 'Driver no-show.')).status).toBe(201);

    const r = await post(customer, `shipping/${shipment.id}/cancel`, { reason: 'Nobody ever came.' });
    expect(r.status).toBe(201);
    const ship = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(ship.status).toBe('CANCELLED');
  });
});
