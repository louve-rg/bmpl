/**
 * SHIPPING-E2E (owner directive, section 6, web+map): proof the driver
 * receives the EXACT coordinates the customer selected — not a value the
 * database or Prisma's own (de)serialization has quietly rounded.
 *
 * bmpl-web already did a structural, file:line trace of every hop (the
 * request DTO, `packages/validation/src/shipping.ts`'s coercion, the Float
 * columns in schema.prisma, `ShipmentDriverService.serialize`) and found
 * nothing that transforms or rounds the value. What that trace could not
 * rule out is a real round trip through Postgres's own float8 storage and
 * Prisma's own (de)serialization — this spec is that round trip, live.
 *
 * Deliberately `toBe` (exact equality), not `toBeCloseTo`: a silent float
 * truncation is exactly the failure this spec exists to catch, and
 * `toBeCloseTo` would hide it instead of reporting the delta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** An approved, online driver with a vehicle, serving the given district — same shape as shipping-pickup-courier-identity.integration.spec.ts. */
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

// Deliberately awkward decimal depth (8 decimal places, ~1.1mm precision) —
// both real Belize-ish values, inside BELIZE_BOUNDS, picked for decimal
// depth rather than geocoded against anything real.
const ORIGIN = { latitude: 17.49931427, longitude: -88.19847091 };
const DESTINATION = { latitude: 16.70001953, longitude: -88.90123456 };

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', ...ORIGIN },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', ...DESTINATION },
  preferredMode: 'AIR',
  description: 'One box',
});

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Coordinate-fidelity test fixture.' });
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

/** Same shortcut shipment-availability-windows-dispatch.integration.spec.ts
 *  uses: fast-forward the earlier legs to COMPLETED directly so the
 *  LAST_MILE leg is actionable, without driving the whole real journey
 *  through the driver app — that mechanics belongs to other specs. Every
 *  line-haul hop, not just the first — this network has two (PLA->MUN,
 *  MUN->SPA). */
async function fastForwardToLastMile(firstMileId: string, lineHaulIds: string[]) {
  await ctx.prisma.shipmentLeg.update({ where: { id: firstMileId }, data: { status: 'COMPLETED', courierStatus: 'DELIVERED' } });
  for (const id of lineHaulIds) {
    await ctx.prisma.shipmentLeg.update({ where: { id }, data: { status: 'COMPLETED', arrivedAt: new Date() } });
  }
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
  await seedBaselineCourierCoverage(ctx.prisma);
});

describe('a driver sees the exact coordinates the customer selected (SHIPPING-E2E)', () => {
  it('1 · the sender\'s own read already matches the submitted value exactly', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies);

    const r = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(r.status).toBe(200);
    expect(r.body.origin.latitude).toBe(ORIGIN.latitude);
    expect(r.body.origin.longitude).toBe(ORIGIN.longitude);
    expect(r.body.destination.latitude).toBe(DESTINATION.latitude);
    expect(r.body.destination.longitude).toBe(DESTINATION.longitude);
  });

  it('2 · the first-mile driver sees the sender\'s exact pin from the moment the job is offered — never rounded, never withheld (owner ruling, SHIP-B)', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    await dispatch.dispatchLeg(firstMile.id);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id } })).assignedDriverProfileId).toBe(
      courier.driverProfileId,
    );

    // Not yet accepted. A driver cannot judge or reach a job they cannot
    // locate, so the pin is already exact here — only identity (contactUnlocked)
    // stays gated until acceptance. Confirms this spec isn't testing around a
    // precision bug hiding behind the old reveal gate.
    const before = await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}`);
    expect(before.status).toBe(200);
    expect(before.body.addressUnlocked).toBe(true);
    expect(before.body.contactUnlocked).toBe(false);
    expect(before.body.pickup.pinnedLocation.latitude).toBe(ORIGIN.latitude);
    expect(before.body.pickup.pinnedLocation.longitude).toBe(ORIGIN.longitude);

    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);

    const after = await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}`);
    expect(after.status).toBe(200);
    expect(after.body.contactUnlocked).toBe(true);
    // The exact value the customer typed, unchanged by acceptance — not the
    // sender's own re-read, which is the claim bmpl-web's structural trace
    // could not settle on its own: did the DB or Prisma round it on the way
    // through?
    expect(after.body.pickup.pinnedLocation.latitude).toBe(ORIGIN.latitude);
    expect(after.body.pickup.pinnedLocation.longitude).toBe(ORIGIN.longitude);
  });

  it('3 · the last-mile driver sees the recipient\'s exact pin too — the same claim, the other end', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls, lastMile } = await journey(shipment.id);
    await fastForwardToLastMile(firstMile.id, lineHauls.map((l) => l.id));

    await dispatch.dispatchLeg(lastMile.id);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lastMile.id } })).assignedDriverProfileId).toBe(
      courier.driverProfileId,
    );

    const before = await get(courier.cookies, `driver/shipping-jobs/${lastMile.id}`);
    expect(before.body.dropoff.pinnedLocation.latitude).toBe(DESTINATION.latitude);
    expect(before.body.dropoff.pinnedLocation.longitude).toBe(DESTINATION.longitude);

    expect((await post(courier.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);

    const after = await get(courier.cookies, `driver/shipping-jobs/${lastMile.id}`);
    expect(after.body.dropoff.pinnedLocation.latitude).toBe(DESTINATION.latitude);
    expect(after.body.dropoff.pinnedLocation.longitude).toBe(DESTINATION.longitude);
  });
});
