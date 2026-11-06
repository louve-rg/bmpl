/**
 * SHIP-B: a customer's availability window (ShipmentService.setAvailabilityWindows)
 * was already persisted correctly, but reached no driver-facing payload — neither
 * the per-job detail (ShipmentDriverService.serialize, GET driver/shipping-jobs/:id)
 * nor the unified list (DriverJobFeedService, GET driver/jobs). This closes both,
 * filtered to the role each specific leg is actually governed by: a FIRST_MILE leg
 * collects, so only the SENDER's window is its business; a LAST_MILE leg delivers,
 * so only the RECIPIENT's is. Shown from offer time (not gated on acceptance) — a
 * time window is not personally identifying.
 *
 * Setup pattern (makeDriver, seedNetwork, disableDispatch, doorToDoor, book, legs,
 * assign) is verbatim from shipment-driver-data-rules.integration.spec.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

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
  const { cookies, userId } = await registerUser(`ddrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Ddv${s}`, phone: '+5016000000',
      homeDistrict: 'BELIZE', licenceNumber: `DDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `DZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Three airstrips, two AIR line-hauls: PLA -> MUN -> SPA. Verbatim from shipment-driver-data-rules.spec.ts. */
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

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

const getJob = (driver: { cookies: string[] }, legId: string) => get(driver.cookies, `driver/shipping-jobs/${legId}`);
const listJobs = (driver: { cookies: string[] }) => get(driver.cookies, 'driver/jobs?scope=all');

const setWindows = (shipmentId: string, windows: Array<{ role: 'SENDER' | 'RECIPIENT'; startTime: string; endTime: string }>) =>
  put(customer, `shipping/${shipmentId}/availability-windows`, { windows });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

async function pickupPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { pickupPin: true } })).pickupPin!;
}

/** A driver takes a courier leg from offer through to a verified handoff. Verbatim from shipping-driver.integration.spec.ts. */
async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`, { pin: await pickupPinFor(legId) })).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect(
    (await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Receiver' })).status,
  ).toBe(201);
}

/** A carrier flies a LINE_HAUL leg hub to hub. Verbatim from shipping-driver.integration.spec.ts. */
async function flyLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' })).status).toBe(201);
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
  await ctx.prisma.shipmentAvailabilityWindow.deleteMany();
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
  const c = await registerUser(`ddcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Availability-window fixture.' });
  await disableDispatch();
  await seedNetwork();
  await seedBaselineCourierCoverage(ctx.prisma);
});

describe('SHIP-B: a shipment availability window reaches the driver, filtered to the leg it actually governs', () => {
  it('a FIRST_MILE leg sees only the SENDER window, never the RECIPIENT one set on the same shipment', async () => {
    const driver = await makeDriver();
    const s = await book();
    const win = await setWindows(s.id, [
      { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
      { role: 'RECIPIENT', startTime: '14:00', endTime: '18:00' },
    ]);
    // PUT is a replace, not a create — the endpoint correctly returns 200, not
    // 201. (Caught by Michael's CI run against PR #588: the feature was right,
    // this expectation was wrong.)
    expect(win.status).toBe(200);

    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    const job = await getJob(driver, first.id);
    expect(job.status).toBe(200);
    expect(job.body.availabilityWindows).toEqual([{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }]);
  });

  it('a LAST_MILE leg sees only the RECIPIENT window, never the SENDER one set on the same shipment', async () => {
    const driver = await makeDriver();
    const s = await book();
    const win = await setWindows(s.id, [
      { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
      { role: 'RECIPIENT', startTime: '14:00', endTime: '18:00' },
    ]);
    // Same PUT-is-200-not-201 correction as above.
    expect(win.status).toBe(200);

    // Same dispatch invariant as the list-labelling test below: a LAST_MILE
    // leg cannot be assigned until the parcel has actually travelled there.
    const rows = await legs(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    await driveCourierLeg(driver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);

    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect((await assign(last.id, driver)).status).toBe(201);

    const job = await getJob(driver, last.id);
    expect(job.status).toBe(200);
    expect(job.body.availabilityWindows).toEqual([{ role: 'RECIPIENT', startTime: '14:00', endTime: '18:00' }]);
  });

  it('is visible to the driver before acceptance, on an offer the driver has not yet taken', async () => {
    const driver = await makeDriver();
    const s = await book();
    expect((await setWindows(s.id, [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }])).status).toBe(200);

    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    // Not accepted yet — still ASSIGNED. addressUnlocked is structurally
    // always true for a leg's own door (owner ruling, SHIP-B: there is
    // nothing left to lock pre-acceptance) — contactUnlocked is the gate
    // that's still false here. Either way, the window is not personally
    // identifying, so it must already be visible.
    const job = await getJob(driver, first.id);
    expect(job.status).toBe(200);
    expect(job.body.addressUnlocked).toBe(true);
    expect(job.body.contactUnlocked).toBe(false);
    expect(job.body.availabilityWindows).toEqual([{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }]);
  });

  it('is an empty array, not absent, when no window was ever set', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    const job = await getJob(driver, first.id);
    expect(job.status).toBe(200);
    expect(job.body.availabilityWindows).toEqual([]);
  });

  it('also reaches the unified job list, filtered the same way', async () => {
    const driver = await makeDriver();
    const s = await book();
    expect((await setWindows(s.id, [
      { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
      { role: 'RECIPIENT', startTime: '14:00', endTime: '18:00' },
    ])).status).toBe(200);

    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    const list = await listJobs(driver);
    expect(list.status).toBe(200);
    const item = list.body.find((j: { id: string }) => j.id === first.id);
    expect(item).toBeDefined();
    expect(item.availabilityWindows).toEqual([{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }]);
  });
});

describe('SHIP-B: the job list honestly labels which end is a public terminal vs a private address', () => {
  it('a FIRST_MILE job: pickup is the sender\'s door (ADDRESS), dropoff is the terminal (HUB)', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    const list = await listJobs(driver);
    expect(list.status).toBe(200);
    const item = list.body.find((j: { id: string }) => j.id === first.id);
    expect(item.pickup.kind).toBe('ADDRESS');
    expect(item.dropoff.kind).toBe('HUB');
  });

  it('a LAST_MILE job: pickup is the terminal (HUB), dropoff is the recipient\'s door (ADDRESS)', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    // THE dispatch invariant (shipment-dispatch.service.ts assignManual):
    // "no driver is sent where the parcel is not" — admin assign refuses a
    // LAST_MILE leg outright (400, isLegActionable) until the parcel has
    // actually travelled there. The earlier version of this test skipped
    // straight to assigning LAST_MILE and was refused for exactly that
    // reason; this is the invariant working correctly, not a feature gap.
    expect((await assign(first.id, driver)).status).toBe(201);
    await driveCourierLeg(driver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);

    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect((await assign(last.id, driver)).status).toBe(201);

    const list = await listJobs(driver);
    expect(list.status).toBe(200);
    const item = list.body.find((j: { id: string }) => j.id === last.id);
    expect(item.pickup.kind).toBe('HUB');
    expect(item.dropoff.kind).toBe('ADDRESS');
  });
});
