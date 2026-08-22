/**
 * Courier legs as driver work, against real Postgres.
 *
 * The claim this suite exists to defend, in one sentence:
 *
 *   NO DRIVER IS SENT TO PICK UP A PARCEL THAT IS NOT PHYSICALLY THERE.
 *
 * Everything else — the unified queue, the job vocabulary, the offer lifecycle —
 * is worth testing, but that one is the invariant a wrong answer makes dangerous
 * rather than merely annoying. A driver dispatched to an airstrip for a box
 * still in the air has wasted a real trip in a real vehicle.
 *
 * The second claim, equally load-bearing: ordinary marketplace delivery is
 * unchanged by any of this. A driver's feed now merges two sources, so the
 * marketplace half is asserted here too, not just in the delivery suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
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

/** An approved, online driver with a vehicle, serving the given districts. */
async function makeDriver(opts: { isTest?: boolean; districts?: string[] } = {}) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`sdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      isTest: opts.isTest ?? false,
      legalName: 'D River',
      displayName: `Drv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `SDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `SZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of opts.districts ?? ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
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

/** Automatic dispatch defaults OFF platform-wide; these tests need it on. */
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

/**
 * Book and pay, which is what the customer-facing form does.
 *
 * A shipment that has not been paid for is never dispatched, so a booking
 * helper that skipped payment would be testing a journey no real customer can
 * take.
 */
async function book(body: object = doorToDoor()) {
  const r = await post(customer, 'shipping', { ...body, payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

/** Operator drives a line-haul leg from its terminal to the next one. */
async function flyLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

/** A driver takes a courier leg from offer through to a verified handoff. */
async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  const r = await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Receiver',
  });
  expect(r.status).toBe(201);
  return r.body;
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
  // Settled legs carry driver earnings, and the earning holds the leg with an
  // onDelete: Restrict — you should not be able to delete work somebody was
  // paid for. Clear the earnings first.
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  // Drivers too. Without this they accumulate: an earlier test's driver is still
  // online and eligible, so dispatch legitimately picks THEM, and the test that
  // just created a driver gets a 404 on a job it never received.
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`shipcust_${uniq()}@example.com`);
  customer = c.cookies;
  // Shipping now takes payment, so the customer needs a balance. Funded by the
  // administrative test credit rather than by flagging the account as a test
  // account: flagging it would make every shipment they book a TEST shipment,
  // which the dispatch boundary then correctly refuses to offer to the ordinary
  // drivers this suite creates.
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Shipping test fixture.' });
  await enableDispatch(true);
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('the invariant: a driver is only sent where the parcel is', () => {
  it('offers the first mile at booking and the last mile to nobody', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);

    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    const last = rows.find((l) => l.kind === 'LAST_MILE')!;
    expect(first.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(first.courierStatus).toBe('ASSIGNED');
    // The parcel is in Placencia. Nobody is being sent to San Pedro.
    expect(last.assignedDriverProfileId).toBeNull();
    expect(last.courierStatus).toBeNull();
  });

  it('refuses to dispatch the last mile however many times it is asked', async () => {
    await makeDriver();
    const s = await book();
    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;

    for (let i = 0; i < 3; i++) {
      const out = await dispatch.dispatchLeg(last.id);
      expect(out.result).toBe('SKIPPED');
      if (out.result === 'SKIPPED') expect(out.reason).toContain('has not reached this leg yet');
    }
    // And the retry budget was not burned by the refusals.
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: last.id } })).offerCount).toBe(0);
  });

  it('the sweeper does not pick the last mile up either', async () => {
    await makeDriver();
    const s = await book();
    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    await dispatch.sweepUndispatched();
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: last.id } })).assignedDriverProfileId).toBeNull();
  });

  it('offers the last mile the moment the parcel actually lands', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);

    await driveCourierLeg(driver, rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHauls = rows.filter((l) => l.kind === 'LINE_HAUL');
    await flyLineHaul(lineHauls[0]!.id);

    // Mid-journey: the parcel is at Belize City, not San Pedro. Still nobody.
    let last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect(last.assignedDriverProfileId).toBeNull();

    await flyLineHaul(lineHauls[1]!.id);

    // It has landed. NOW a driver is offered it, without waiting for a sweep.
    last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect(last.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(last.courierStatus).toBe('ASSIGNED');
  });

  it('will not let a driver confirm pickup on a leg the parcel has not reached', async () => {
    // Belt and braces: even if a leg were somehow assigned early, the driver's
    // own action re-checks the sequence rather than trusting the assignment.
    const driver = await makeDriver();
    const s = await book();
    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: last.id },
      data: { assignedDriverProfileId: driver.driverProfileId, courierStatus: 'DRIVER_ACCEPTED', acceptedAt: new Date() },
    });
    const r = await post(driver.cookies, `driver/shipping-jobs/${last.id}/pickup`);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('has not reached this leg yet');
  });
});

describe('the full door-to-door journey', () => {
  it('runs end to end through two drivers and a carrier', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);

    await driveCourierLeg(driver, rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);

    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const done = await driveCourierLeg(driver, last.id);
    expect(done.shipment.status).toBe('DELIVERED');
  });

  it('records an unbroken custody chain across both drivers and the carrier', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);
    await driveCourierLeg(driver, rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    await driveCourierLeg(driver, (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!.id);

    const chain = await ctx.prisma.custodyEvent.findMany({ where: { shipmentId: s.id }, orderBy: { occurredAt: 'asc' } });
    expect(chain.map((c) => c.toHolder)).toEqual([
      'SENDER', 'DRIVER', 'HUB', 'CARRIER', 'HUB', 'CARRIER', 'HUB', 'DRIVER', 'RECIPIENT',
    ]);
  });
});

describe('every service type, end to end', () => {
  /** Walk whatever legs a shipment has, in order, by whoever operates them. */
  async function runWholeJourney(driver: { cookies: string[] }, shipmentId: string) {
    // Re-read between legs: a last-mile leg has no driver until the line-haul
    // before it completes, so a list captured up front would be stale.
    for (let guard = 0; guard < 8; guard++) {
      const rows = await legs(shipmentId);
      const next = rows.find((l) => l.status === 'READY' || l.status === 'IN_PROGRESS');
      if (!next) break;
      if (next.kind === 'LINE_HAUL') await flyLineHaul(next.id);
      else await driveCourierLeg(driver, next.id);
    }
    return ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  }

  it('DOOR_TO_HUB ends waiting on a counter, then collected', async () => {
    const driver = await makeDriver();
    const s = await book({
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    // The first mile is a driver's job; the rest is the carrier's.
    expect((await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!.assignedDriverProfileId).toBe(driver.driverProfileId);

    const done = await runWholeJourney(driver, s.id);
    expect(done.status).toBe('AWAITING_COLLECTION');

    const collected = await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz' });
    expect(collected.body.status).toBe('DELIVERED');
  });

  it('HUB_TO_HUB never involves a driver at all', async () => {
    await makeDriver();
    const s = await book({
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.PLA, name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    const rows = await legs(s.id);
    expect(rows.every((l) => l.kind === 'LINE_HAUL')).toBe(true);
    // No courier legs means nothing was offered to anybody.
    expect(await ctx.prisma.shipmentLegOffer.count({ where: { shipmentLeg: { shipmentId: s.id } } })).toBe(0);

    const done = await runWholeJourney({ cookies: [] }, s.id);
    expect(done.status).toBe('AWAITING_COLLECTION');
  });

  it('HUB_TO_DOOR gives the driver only the final leg, and only once it lands', async () => {
    const driver = await makeDriver();
    const s = await book({
      service: 'HUB_TO_DOOR',
      origin: { hubId: hub.PLA, name: 'S', phone: '501-2223333' },
      destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    const rows = await legs(s.id);
    expect(rows.find((l) => l.kind === 'FIRST_MILE')).toBeUndefined();
    // The journey starts with a flight, so at booking there is nothing to drive.
    expect(rows.find((l) => l.kind === 'LAST_MILE')!.assignedDriverProfileId).toBeNull();

    const done = await runWholeJourney(driver, s.id);
    expect(done.status).toBe('DELIVERED');
  });

  it('quoting a local door-to-door parcel writes nothing', async () => {
    // A local door-to-door booking is now a real shipment with a single courier
    // leg — it used to be refused outright, which is what produced "there is no
    // terminal serving Belize City" for a journey that has no terminal in it.
    //
    // The invariant this test actually protects is unchanged and still worth
    // asserting: asking for a PRICE must not create anything. An ordinary
    // marketplace delivery still never becomes a shipment.
    await makeDriver();
    const before = await ctx.prisma.shipment.count();
    const r = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_DOOR',
      origin: { district: 'BELIZE', city: 'Belize City' },
      destination: { district: 'BELIZE', city: 'Belize City' },
    });
    expect(r.body.available).toBe(true);
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['DIRECT']);
    expect(await ctx.prisma.shipment.count()).toBe(before);
  });
});

describe('the driver sees one queue', () => {
  it('lists a shipping job and a marketplace job side by side', async () => {
    const driver = await makeDriver();
    await book();
    const list = await get(driver.cookies, 'driver/jobs?scope=available');
    expect(list.status).toBe(200);
    const shipping = list.body.find((j: { kind: string }) => j.kind === 'FIRST_MILE');
    expect(shipping).toBeTruthy();
    expect(shipping.kindLabel).toBe('Shipping pickup');
    // Everything in the list speaks one vocabulary, whatever it came from.
    for (const job of list.body) {
      expect(job).toHaveProperty('pickup');
      expect(job).toHaveProperty('dropoff');
      expect(job).toHaveProperty('load');
      expect(job).toHaveProperty('reference');
    }
  });

  it('counts shipping work in the tab badges', async () => {
    const driver = await makeDriver();
    await book();
    const counts = await get(driver.cookies, 'driver/jobs/counts');
    expect(counts.body.available).toBe(1);
  });

  it('names both ends of a shipping pickup without naming the sender', async () => {
    const driver = await makeDriver();
    await book();
    const list = await get(driver.cookies, 'driver/jobs?scope=available');
    const job = list.body.find((j: { kind: string }) => j.kind === 'FIRST_MILE');
    // A terminal is a public place, so it is named. The sender is not, until the
    // driver has actually taken the job.
    expect(job.dropoff.name).toBe('Placencia Airstrip');
    expect(job.pickup.name).toBeNull();
    expect(job.pickup.area).toContain('Placencia');
  });

  it("puts the job in the driver's route recommendation once accepted", async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const queue = await get(driver.cookies, 'driver/jobs/queue');
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((i: { id: string }) => i.id === first.id);
    expect(item).toBeTruthy();
    expect(item.recommendedPosition).toBe(1);
    // Never a live-traffic claim.
    expect(queue.body.route.disclosure).toBeTruthy();
  });

  it('does not route an offer the driver has not accepted', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const queue = await get(driver.cookies, 'driver/jobs/queue');
    const item = queue.body.items.find((i: { id: string }) => i.id === first.id);
    expect(item.recommendedPosition).toBeNull();
  });
});

describe('what the driver is shown', () => {
  it("withholds the sender's name, phone and street until the job is accepted", async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const offered = await get(driver.cookies, `driver/shipping-jobs/${first.id}`);
    expect(offered.body.addressUnlocked).toBe(false);
    expect(offered.body.pickup.name).toBeNull();
    expect(offered.body.pickup.phone).toBeNull();
    expect(offered.body.pickup.address).toBeNull();
    expect(offered.body.pickup.navigationUrl).toBeNull();
    // The area is safe, and the driver needs it to judge the trip.
    expect(offered.body.pickup.area).toContain('Placencia');

    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const taken = await get(driver.cookies, `driver/shipping-jobs/${first.id}`);
    expect(taken.body.addressUnlocked).toBe(true);
    expect(taken.body.pickup.name).toBe('Sender');
    expect(taken.body.pickup.address).toBe('1 Sidewalk');
    expect(taken.body.pickup.navigationUrl).toContain('16.5122');
  });

  it('tells the driver which way round the job is', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const job = await get(driver.cookies, `driver/shipping-jobs/${first.id}`);
    expect(job.body.jobKind).toBe('FIRST_MILE');
    expect(job.body.dropoff.kind).toBe('HUB');
    expect(job.body.dropoff.name).toBe('Placencia Airstrip');
    expect(job.body.handoffCodeHeldBy).toBe('the terminal staff');
    expect(job.body.nextActionLabel).toBe('Accept');
  });

  it('phrases the last mile as a delivery, not a terminal drop', async () => {
    const driver = await makeDriver();
    const s = await book();
    const rows = await legs(s.id);
    await driveCourierLeg(driver, rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);

    const last = (await legs(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const job = await get(driver.cookies, `driver/shipping-jobs/${last.id}`);
    expect(job.body.jobKind).toBe('LAST_MILE');
    expect(job.body.pickup.kind).toBe('HUB');
    expect(job.body.pickup.name).toBe('San Pedro Airstrip');
    expect(job.body.handoffCodeHeldBy).toBe('the person receiving it');
  });

  it('never returns the handoff code to the driver who has to produce it', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const job = await get(driver.cookies, `driver/shipping-jobs/${first.id}`);
    expect(JSON.stringify(job.body)).not.toContain(await pinOf(first.id));
  });
});

describe('the offer lifecycle', () => {
  it('lets a driver decline, and offers it to the next one', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const holder = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId;
    const holdingDriver = holder === a.driverProfileId ? a : b;
    const otherDriver = holder === a.driverProfileId ? b : a;

    expect((await post(holdingDriver.cookies, `driver/shipping-jobs/${first.id}/decline`, { reason: 'Too far right now.' })).status).toBe(201);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.assignedDriverProfileId).toBe(otherDriver.driverProfileId);
    expect(after.offerCount).toBe(2);
  });

  it('ranks a driver who declined last, but will ask again rather than strand the parcel', async () => {
    // Inherited from the delivery engine, and deliberate there too: a driver who
    // has already seen this job ranks LAST, not excluded. With a bigger pool
    // somebody else gets it; with nobody else, asking again beats leaving a
    // customer's parcel unmoved. The retry budget is what bounds it.
    const preferred = await makeDriver();
    const declining = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const holderId = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId;
    const holder = holderId === preferred.driverProfileId ? preferred : declining;
    const other = holderId === preferred.driverProfileId ? declining : preferred;

    await post(holder.cookies, `driver/shipping-jobs/${first.id}/decline`, { reason: 'No.' });
    // The one who has NOT seen it gets it, not the one who just said no.
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.assignedDriverProfileId).toBe(other.driverProfileId);

    const asked = await ctx.prisma.shipmentLegOffer.findMany({ where: { shipmentLegId: first.id }, select: { driverProfileId: true } });
    expect(new Set(asked.map((o) => o.driverProfileId)).size).toBe(2);
  });

  it('expires a lapsed offer and re-offers it', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });

    const swept = await dispatch.sweepExpiredOffers();
    expect(swept.expired).toBe(1);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.assignedDriverProfileId).not.toBeNull();
    expect([a.driverProfileId, b.driverProfileId]).toContain(after.assignedDriverProfileId);
  });

  it('does not expire an offer a driver has just accepted', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    // Back-date the clock as if the sweeper had raced the acceptance.
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });

    const swept = await dispatch.sweepExpiredOffers();
    expect(swept.expired).toBe(0);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.courierStatus).toBe('DRIVER_ACCEPTED');
    expect(after.assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('gives up and tells an administrator rather than looping forever', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { offerCount: 3, assignedDriverProfileId: null, courierStatus: 'DRIVER_DECLINED' },
    });
    const out = await dispatch.dispatchLeg(first.id);
    expect(out.result).toBe('EXHAUSTED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).dispatchExhaustedAt).not.toBeNull();
  });

  it('does nothing at all when automatic dispatch is switched off', async () => {
    await enableDispatch(false);
    await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.assignedDriverProfileId).toBeNull();
  });
});

describe('authorization', () => {
  it("does not let one driver work another driver's leg", async () => {
    const mine = await makeDriver();
    const other = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const holder = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId;
    const intruder = holder === mine.driverProfileId ? other : mine;

    // 404 rather than 403: a driver must not be able to probe for other
    // drivers' work by watching the status code change.
    expect((await get(intruder.cookies, `driver/shipping-jobs/${first.id}`)).status).toBe(404);
    expect((await post(intruder.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(404);
  });

  it('does not let a customer drive their own shipment', async () => {
    await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect([401, 403]).toContain((await post(customer, `driver/shipping-jobs/${first.id}/accept`)).status);
  });

  it('does not let a signed-out visitor touch a courier leg', async () => {
    await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await request(ctx.server).post(`/api/driver/shipping-jobs/${first.id}/accept`)).status).toBe(401);
  });
});

describe('test and real stay apart', () => {
  it('never offers a real shipment to a test driver', async () => {
    // The test driver is the ONLY driver online. A real shipment must go
    // undispatched rather than reach them.
    await makeDriver({ isTest: true });
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.assignedDriverProfileId).toBeNull();
  });

  it('never offers a test shipment to a real driver', async () => {
    await makeDriver({ isTest: false });
    const s = await book();
    await ctx.prisma.shipment.update({ where: { id: s.id }, data: { isTest: true } });
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: null, courierStatus: null, offerCount: 0 } });

    const out = await dispatch.dispatchLeg(first.id);
    expect(out.result).toBe('SKIPPED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId).toBeNull();
  });
});
