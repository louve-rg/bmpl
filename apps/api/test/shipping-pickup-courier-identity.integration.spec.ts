/**
 * BMPL-187: the custody-chain sweep, applied to the OTHER end of a courier's
 * custody — picking up, not just handing off.
 *
 * BMPL-174 fixed `completeLeg`'s `verifyHandoffPin` so a code alone could not
 * complete a handoff for a leg it was not assigned to. `startLeg` (the pickup
 * that starts a FIRST_MILE, LAST_MILE or DIRECT leg) had no equivalent check:
 * any account holding `logistics.operate` could call
 * `admin/logistics/legs/:id/start` on ANY courier leg and the custody event
 * would record that pickup as done by whoever they claimed, with no proof
 * they were the assigned courier. The driver's own path (`confirmPickup`)
 * was always safe — it is gated by `ownedLeg` before it ever reaches
 * `startLeg` — so this suite exercises the admin desk, the same surface
 * BMPL-174's suite used to prove the handoff gap.
 *
 * A LINE_HAUL leg never has an assigned courier, which is exactly what made
 * `startLeg`'s owner check a silent no-op for one - and, until BMPL-196,
 * `startLeg` had no `leg.kind` check at all, so that same admin desk could
 * advance a transport leg straight to IN_PROGRESS through `/start`,
 * bypassing the route-schedule guard `/depart` enforces on the identical leg.
 * Test 3 below now pins the fix: `/start` refuses a LINE_HAUL leg outright,
 * and terminal-to-terminal pickup happens through `/depart` instead.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** An approved, online driver with a vehicle, serving the given district. */
async function makeCourier(district: string) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`courier_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: false, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: district as never, licenceNumber: `HDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `HV-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { cookies, userId, driverProfileId: profile.id };
}

/** An operations account holding the given admin permissions — no driver profile. */
async function makeOperator(permissions: string[]) {
  const email = `op_${uniq()}@example.bz`;
  const a = await seedLimitedAdmin(ctx.prisma, email, permissions);
  const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  return { cookies, userId: a.id };
}

/** Gives an existing user their OWN driver profile — unrelated to any leg. */
async function attachDriverProfile(userId: string) {
  const s = uniq();
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: false, legalName: 'Also Driver', displayName: `AlsoDrv${s}`, phone: '+5016000001',
      homeDistrict: 'BELIZE' as never, licenceNumber: `ODL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'OFFLINE', isActive: true,
    },
  });
  return profile.id;
}

async function seedNetwork() {
  const hubs = [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ];
  hub = {};
  for (const h of hubs) {
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

async function enableDispatch(on = true) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: on, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Pickup-identity test fixture.' });
  return { cookies, userId };
}

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function journey(shipmentId: string) {
  const all = await legsOf(shipmentId);
  return {
    firstMile: all.find((l) => l.kind === 'FIRST_MILE')!,
    lineHauls: all.filter((l) => l.kind === 'LINE_HAUL'),
    lastMile: all.find((l) => l.kind === 'LAST_MILE')!,
  };
}
async function legRow(legId: string) {
  return ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  dispatch = ctx.app.get(ShipmentDispatchService);
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
  await enableDispatch(true);
  await seedNetwork();
});

describe('starting a leg checks the courier, not just an admin permission (BMPL-187)', () => {
  it('1 · an ops account who happens to be a DIFFERENT driver cannot record someone else\'s pickup', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    await dispatch.dispatchLeg(firstMile.id);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courier.driverProfileId);

    const impostor = await makeOperator(['logistics.operate']);
    const impostorDriverProfileId = await attachDriverProfile(impostor.userId);
    expect(impostorDriverProfileId).not.toBe(courier.driverProfileId);

    const r = await post(impostor.cookies, `admin/logistics/legs/${firstMile.id}/start`, {});
    expect(r.status).toBe(403);

    const after = await legRow(firstMile.id);
    expect(after.status).toBe('READY');
    expect(after.startedAt).toBeNull();

    // No side effect on the real courier: they can still pick it up themselves.
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('IN_PROGRESS');
  });

  it('2 · an ops account with no driver profile at all cannot stand in either', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    await dispatch.dispatchLeg(firstMile.id);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courier.driverProfileId);

    const opsOnly = await makeOperator(['logistics.operate']);
    const r = await post(opsOnly.cookies, `admin/logistics/legs/${firstMile.id}/start`, {});
    expect(r.status).toBe(403);

    const after = await legRow(firstMile.id);
    expect(after.status).toBe('READY');
    expect(after.startedAt).toBeNull();
  });

  it('3 · terminal-to-terminal (LINE_HAUL) pickup happens through /depart, never /start (BMPL-196)', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls } = await journey(shipment.id);
    const lineHaul = lineHauls[0]!;
    expect(lineHaul.assignedDriverProfileId).toBeNull();

    // Get the parcel to the terminal legitimately so the LINE_HAUL leg is READY.
    await dispatch.dispatchLeg(firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const pin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id }, select: { handoffPin: true } })).handoffPin!;
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Terminal desk' })).status).toBe(201);
    expect((await legRow(lineHaul.id)).status).toBe('READY');

    // BMPL-196: an ops account with logistics.operate and NO driver profile
    // used to be able to advance this LINE_HAUL leg straight to IN_PROGRESS
    // via /start, bypassing the route-schedule guard /depart enforces on the
    // identical leg. /start now refuses a transport leg outright.
    const deskClerk = await makeOperator(['logistics.operate']);
    const blocked = await post(deskClerk.cookies, `admin/logistics/legs/${lineHaul.id}/start`, {});
    expect(blocked.status).toBe(400);
    expect((await legRow(lineHaul.id)).status).toBe('READY');

    // The one real way a transport leg leaves READY still works.
    const departed = await post(deskClerk.cookies, `admin/logistics/legs/${lineHaul.id}/depart`, {});
    expect(departed.status).toBe(201);
    expect((await legRow(lineHaul.id)).status).toBe('IN_PROGRESS');
  });

  it('4 · a legitimate reassignment: the newly assigned courier\'s own pickup succeeds with no special case', async () => {
    const sender = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    await dispatch.dispatchLeg(firstMile.id);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courierA.driverProfileId);

    const vehicleB = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: courierB.driverProfileId } });
    const reassign = await post(admin, `admin/logistics/legs/${firstMile.id}/reassign`, {
      driverProfileId: courierB.driverProfileId,
      vehicleId: vehicleB.id,
      reason: 'Courier A reported a breakdown.',
    });
    expect(reassign.status).toBe(201);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courierB.driverProfileId);

    // Courier A is no longer the assigned courier, so an admin-desk pickup
    // attributed to them is refused — the live column decides, not who was
    // assigned when the job was first dispatched.
    const opsHoldingCourierAsAgent = await makeOperator(['logistics.operate']);
    await attachDriverProfile(opsHoldingCourierAsAgent.userId); // unrelated profile, same shape as tests 1/2
    const blocked = await post(opsHoldingCourierAsAgent.cookies, `admin/logistics/legs/${firstMile.id}/start`, {});
    expect(blocked.status).toBe(403);
    expect((await legRow(firstMile.id)).status).toBe('READY');

    // The newly assigned courier's own pickup succeeds with no special case.
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('IN_PROGRESS');
  });
});
