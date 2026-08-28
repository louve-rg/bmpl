/**
 * Nobody couriers their own parcel.
 *
 * The same rule as marketplace self-delivery, on the shipping side. A courier
 * leg exists precisely so that somebody other than the sender carries the goods:
 * the sender who is also the courier confirms their own collection, signs their
 * own handoff, and is paid the courier fee out of the shipment they booked.
 *
 * Both mile types are covered, and both halves of the rule — the refusal, and
 * the proof that a legitimate separate driver can still do the job.
 *
 * NOT covered here, because the surface does not exist: there is no
 * administrative manual leg-assignment endpoint. Courier legs are assigned only
 * by the dispatcher, so the exclusion in `ShipmentDispatchService` plus the
 * acceptance check is the whole attack surface today. If a manual assign route
 * is ever added it needs the same guard `DispatchService.assignInternal` has.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string>;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Give an existing user an approved, online driver profile in these districts. */
async function driverFor(userId: string, districts: string[]) {
  const s = uniq();
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: districts[0] as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const d of districts) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { driverProfileId: profile.id };
}

async function separateDriver(districts: string[]) {
  const { cookies, userId } = await registerUser(`sdrv_${uniq()}@example.com`);
  const d = await driverFor(userId, districts);
  return { cookies, userId, ...d };
}

/** A funded sender who is ALSO an online driver covering both ends of the route. */
async function senderWhoDrives() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Self-courier test fixture.' });
  const own = await driverFor(userId, ['STANN_CREEK', 'BELIZE']);
  return { cookies, userId, ownDriverProfileId: own.driverProfileId };
}

async function seedNetwork() {
  const hubs = [
    { code: 'MUN', name: 'Belize City Municipal', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
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

async function enableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** Placencia → San Pedro by air: FIRST_MILE, LINE_HAUL, LAST_MILE. */
const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

/**
 * Make sure a leg has been offered, and return the row.
 *
 * The dispatch sweeper runs inside the booted application and may already have
 * offered this leg, in which case `dispatchLeg` correctly reports SKIPPED
 * ("leg is ASSIGNED"). Asserting on the call's return value would therefore be
 * a race against the scheduler; the leg row is the fact that matters.
 */
async function ensureOffered(legId: string) {
  await dispatch.dispatchLeg(legId);
  return ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
}

const legsOf = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const pinOf = async (legId: string) =>
  (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;

/** The courier legs of a shipment, by kind — the route may have several line hauls. */
async function journey(shipmentId: string) {
  const all = await legsOf(shipmentId);
  return {
    firstMile: all.find((l) => l.kind === 'FIRST_MILE')!,
    lineHauls: all.filter((l) => l.kind === 'LINE_HAUL'),
    lastMile: all.find((l) => l.kind === 'LAST_MILE')!,
  };
}

async function flyLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' })).status).toBe(201);
}

async function driveLeg(cookies: string[], legId: string) {
  expect((await post(cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Receiver' })).status).toBe(201);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  dispatch = ctx.app.get(ShipmentDispatchService);
  await seedNetwork();
});
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await enableDispatch();
  // The shipping network fixes the districts, so tests cannot be separated by
  // service area the way the marketplace ones are. Park every driver created by
  // an earlier test instead: each test then brings its own online drivers and
  // the candidate pool contains exactly who that test intended.
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

describe('shipping — the sender is never the courier', () => {
  it('G · will not offer the sender their own FIRST_MILE leg', async () => {
    const sender = await senderWhoDrives();
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    const leg = await ensureOffered(firstMile.id);
    expect(leg.assignedDriverProfileId).toBeNull();
    expect(await ctx.prisma.shipmentLegOffer.count({
      where: { shipmentLegId: firstMile.id, driverProfileId: sender.ownDriverProfileId },
    })).toBe(0);
  });

  it('H · will not offer the sender their own LAST_MILE leg', async () => {
    const sender = await senderWhoDrives();
    const courier = await separateDriver(['STANN_CREEK']);   // covers the first mile only
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls, lastMile } = await journey(shipment.id);

    // Get the parcel to the destination terminal legitimately.
    expect((await ensureOffered(firstMile.id)).assignedDriverProfileId).toBe(courier.driverProfileId);
    await driveLeg(courier.cookies, firstMile.id);
    for (const lh of lineHauls) await flyLineHaul(lh.id);

    // The last mile is in BELIZE, where the only online driver is the sender.
    const leg = await ensureOffered(lastMile.id);
    expect(leg.assignedDriverProfileId).toBeNull();
    expect(await ctx.prisma.shipmentLegOffer.count({
      where: { shipmentLegId: lastMile.id, driverProfileId: sender.ownDriverProfileId },
    })).toBe(0);
  });

  it('I · refuses the sender accepting their own leg directly', async () => {
    const sender = await senderWhoDrives();
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    // Unassigned: ownership alone already refuses.
    expect((await get(sender.cookies, `driver/shipping-jobs/${firstMile.id}`)).status).toBe(404);
    expect((await post(sender.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(404);

    // The case ownership does not cover — a leg genuinely assigned to the
    // sender's own profile, as a bug or bad backfill would leave it. Written
    // directly because no supported path can produce it.
    await ctx.prisma.shipmentLeg.update({
      where: { id: firstMile.id },
      data: { courierStatus: 'ASSIGNED', assignedDriverProfileId: sender.ownDriverProfileId, assignedAt: new Date() },
    });
    expect((await post(sender.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(404);
    expect((await get(sender.cookies, `driver/shipping-jobs/${firstMile.id}`)).status).toBe(404);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id } });
    expect(leg.acceptedAt).toBeNull();
  });

  it('K · a separate driver still receives and completes the FIRST_MILE', async () => {
    const sender = await senderWhoDrives();
    const courier = await separateDriver(['STANN_CREEK']);
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    const leg = await ensureOffered(firstMile.id);
    expect(leg.assignedDriverProfileId).toBe(courier.driverProfileId);
    expect(leg.assignedDriverProfileId).not.toBe(sender.ownDriverProfileId);

    await driveLeg(courier.cookies, firstMile.id);
    const done = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id } });
    expect(done.courierStatus).toBe('DELIVERED');
  });

  it('L · a separate driver still receives and completes the LAST_MILE', async () => {
    const sender = await senderWhoDrives();
    const firstCourier = await separateDriver(['STANN_CREEK']);
    const lastCourier = await separateDriver(['BELIZE']);
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls, lastMile } = await journey(shipment.id);

    expect((await ensureOffered(firstMile.id)).assignedDriverProfileId).toBe(firstCourier.driverProfileId);
    await driveLeg(firstCourier.cookies, firstMile.id);
    for (const lh of lineHauls) await flyLineHaul(lh.id);

    const leg = await ensureOffered(lastMile.id);
    expect(leg.assignedDriverProfileId).toBe(lastCourier.driverProfileId);
    expect(leg.assignedDriverProfileId).not.toBe(sender.ownDriverProfileId);

    await driveLeg(lastCourier.cookies, lastMile.id);
    const done = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lastMile.id } });
    expect(done.courierStatus).toBe('DELIVERED');
  });
});
