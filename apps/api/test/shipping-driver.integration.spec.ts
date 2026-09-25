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
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
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
    // Priced THROUGH the API (was a direct prisma write while the hub schema
    // dropped courierFeeMinor — the defect fixed on this branch).
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

describe('what ops can see', () => {
  it('shows staff which driver holds a leg; the customer sees no courier pipeline', async () => {
    // Before this, the staff serialization omitted courierStatus and
    // assignedDriverProfileId entirely, so ops could not tell whether a leg
    // already had a driver before acting on it (assign/reassign in the dark).
    const driver = await makeDriver();
    const s = await book();
    const [first] = await legs(s.id);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first!.id}/accept`)).status).toBe(201);

    const staff = await get(admin, `admin/logistics/shipments/${s.reference}`);
    expect(staff.status).toBe(200);
    const staffLeg = staff.body.legs.find((l: { id: string }) => l.id === first!.id);
    expect(staffLeg.courierStatus).toBe('DRIVER_ACCEPTED');
    expect(staffLeg.assignedDriverProfileId).toBe(driver.driverProfileId);

    const own = await get(customer, `shipping/${s.reference}`);
    expect(own.status).toBe(200);
    const custLeg = own.body.legs.find((l: { id: string }) => l.id === first!.id);
    expect(custLeg.courierStatus).toBeNull();
    expect(custLeg.assignedDriverProfileId).toBeNull();
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

describe('cancellation releases the driver from the job', () => {
  /**
   * A leg row carries two views of one fact: `status` for the shipment,
   * `courierStatus` for the driver. Cancelling a shipment must close BOTH —
   * this suite once characterized the defect where only the first closed and
   * the driver was left holding a phantom job they could neither decline
   * (only legal from ASSIGNED) nor work (pickup fails the sequencing rule
   * against a CANCELLED leg). Now it proves the release: assignment cleared,
   * offer history ended, job gone from the feed, and the driver told.
   */
  it('closes the accepted courier leg, ends the offer, and tells the driver', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);

    // The customer cancels in the accepted-but-not-picked-up window — the
    // ordinary case: no leg is IN_PROGRESS yet, so the "already moving" guard
    // does not apply.
    const cancelled = await post(customer, `shipping/${s.id}/cancel`, { reason: 'Changed my mind.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');

    // Both halves of the leg are closed.
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(leg.status).toBe('CANCELLED');
    expect(leg.courierStatus).toBe('CANCELLED');
    expect(leg.assignedDriverProfileId).toBeNull();
    expect(leg.assignedVehicleId).toBeNull();

    // The offer history closes with it.
    const offer = await ctx.prisma.shipmentLegOffer.findFirstOrThrow({
      where: { shipmentLegId: first.id, driverProfileId: driver.driverProfileId },
    });
    expect(offer.status).toBe('CANCELLED');
    expect(offer.endedAt).not.toBeNull();

    // The job is gone from the driver's feed and queue.
    const list = await get(driver.cookies, 'driver/jobs?scope=assigned');
    expect(list.status).toBe(200);
    expect(list.body.some((j: { id: string }) => j.id === first.id)).toBe(false);
    const queue = await get(driver.cookies, 'driver/jobs/queue');
    expect(queue.body.items.some((i: { id: string }) => i.id === first.id)).toBe(false);

    // The driver was told the job no longer exists — the release is only real
    // if the person driving towards the pickup finds out about it.
    expect(
      await ctx.prisma.notificationRecipient.count({
        where: { userId: driver.userId, notification: { event: 'SHIPMENT_LEG_CANCELLED' } },
      }),
    ).toBe(1);

    // And the record no longer resolves for this driver at all: 404, not 400 —
    // once the assignment is cleared the ownership check fails before any
    // state-machine guard is reached.
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`)).status).toBe(404);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/decline`, { reason: 'It was cancelled.' })).status).toBe(404);
  });

  it('releases a driver who merely held the offer, not yet accepted', async () => {
    // Booking auto-offers the first mile: courierStatus ASSIGNED, offer ACTIVE.
    // Cancelling in THAT window must catch the ACTIVE offer too — an offered
    // job sits in the driver's available tab and must leave it the same way an
    // accepted one leaves the queue.
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.courierStatus).toBe('ASSIGNED');

    expect((await post(customer, `shipping/${s.id}/cancel`, { reason: 'Booked by mistake.' })).status).toBe(201);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(leg.status).toBe('CANCELLED');
    expect(leg.courierStatus).toBe('CANCELLED');
    expect(leg.assignedDriverProfileId).toBeNull();
    expect(leg.offerExpiresAt).toBeNull();

    const offer = await ctx.prisma.shipmentLegOffer.findFirstOrThrow({
      where: { shipmentLegId: first.id, driverProfileId: driver.driverProfileId },
    });
    expect(offer.status).toBe('CANCELLED');
    expect(offer.endedAt).not.toBeNull();

    const available = await get(driver.cookies, 'driver/jobs?scope=available');
    expect(available.body.some((j: { id: string }) => j.id === first.id)).toBe(false);

    // The offered driver is told too: the offer was in front of them, and it
    // vanishing silently is how a driver ends up accepting a ghost.
    expect(
      await ctx.prisma.notificationRecipient.count({
        where: { userId: driver.userId, notification: { event: 'SHIPMENT_LEG_CANCELLED' } },
      }),
    ).toBe(1);
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

/**
 * Handoff PIN access — the code reaches the party who is supposed to hold it.
 *
 * Every leg completion verifies a PIN, so every leg's PIN must be OBTAINABLE by
 * its legitimate receiving party: the recipient at their door (LAST_MILE and
 * DIRECT), or the receiving desk at a terminal (everything else, via a
 * deliberate, AUDITED staff reveal). A PIN nobody can obtain is not a
 * verification — it is a leg that can never complete.
 */
describe('handoff PIN access', () => {
  const localDoorToDoor = () => ({
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: 'Belize City', address: '1 North Front Street', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: 'Belize City', address: '9 Albert Street', name: 'Recipient', phone: '501-4445555' },
    description: 'One envelope',
  });
  const referenceOf = async (shipmentId: string) =>
    (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { reference: true } })).reference;

  /**
   * Local door-to-door is priced from a platform setting, not a hub fee, and an
   * unset fee is 0 — which today books a zero-total shipment that the wallet
   * then refuses to escrow (reported separately as a product finding). Seed the
   * fee exactly as the sibling suites do (shipment-payments, shipping), so this
   * test exercises the PIN behaviour it exists for, on a booking that pays.
   */
  // Set through the console's PATCH, not a raw platformSetting write — the raw
  // form was audit finding H1: green tests over a fee path nothing exercised.
  const setLocalCourierFee = async (feeMinor: bigint) => {
    const r = await request(ctx.server)
      .patch('/api/admin/ops/settings')
      .set('Cookie', admin)
      .send({ localCourierFeeMinor: Number(feeMinor), localCourierFeeTestMinor: Number(feeMinor), localCourierMinutes: 60 });
    expect(r.status).toBe(200);
  };

  it('shows a DIRECT leg PIN to the customer, and never in the staff serialization', async () => {
    await makeDriver();
    await setLocalCourierFee(1500n);
    const s = await book(localDoorToDoor());
    const [leg] = await legs(s.id);
    expect(leg!.kind).toBe('DIRECT');
    const reference = await referenceOf(s.id);

    const mine = await get(customer, `shipping/${reference}`);
    expect(mine.status).toBe(200);
    expect(mine.body.legs[0].handoffPin).toBe(await pinOf(leg!.id));

    // Staff serialization stays null — staff reveal it deliberately, not by listing.
    const staff = await get(admin, `admin/logistics/shipments/${reference}`);
    expect(staff.status).toBe(200);
    expect(staff.body.legs[0].handoffPin).toBeNull();
  });

  /** A limited admin holding exactly the given permissions, signed in. */
  const limitedAdmin = async (permissions: string[]) => {
    const seeded = await seedLimitedAdmin(ctx.prisma, `lim_${uniq()}@example.bz`, permissions);
    const login = await request(ctx.server).post('/api/auth/login').send({ email: seeded.email, password: seeded.password });
    return { id: seeded.id, cookies: cookiesOf(login) };
  };

  it('reveals a FIRST_MILE PIN to logistics.verify, and audits WHO asked', async () => {
    await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const verifier = await limitedAdmin(['logistics.verify']);

    const r = await get(verifier.cookies, `admin/logistics/legs/${first.id}/handoff-pin`);
    expect(r.status).toBe(200);
    expect(r.body.handoffPin).toBe(await pinOf(first.id));
    expect(r.body.handoffVerificationStatus).toBe('PENDING');

    const reveals = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_HANDOFF_PIN_REVEALED' } })
    ).filter((row) => (row.newValue as { legId?: string }).legId === first.id);
    expect(reveals).toHaveLength(1);
    // The trail records exactly who asked — never the code itself.
    expect(reveals[0]!.actorId).toBe(verifier.id);
    expect(Object.keys(reveals[0]!.newValue as object)).not.toContain('handoffPin');
    expect(Object.keys(reveals[0]!.newValue as object)).not.toContain('pin');
  });

  it('refuses the reveal to logistics.operate alone — completing a handoff and revealing its code stay two different powers', async () => {
    await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    // This caller can work every leg operation, including consuming the code at
    // the desk. They still cannot READ the code: somebody with logistics.verify
    // has to choose to give it to them. The pair with the test above pins the
    // permission split — a super-admin caller would pass either way and prove
    // nothing.
    const operator = await limitedAdmin(['logistics.operate']);
    const r = await get(operator.cookies, `admin/logistics/legs/${first.id}/handoff-pin`);
    expect(r.status).toBe(403);
  });

  it('refuses the reveal to a customer and to a driver', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await get(customer, `admin/logistics/legs/${first.id}/handoff-pin`)).status).toBe(403);
    expect((await get(driver.cookies, `admin/logistics/legs/${first.id}/handoff-pin`)).status).toBe(403);
  });

  it('refuses to reveal a leg to its own assigned driver, whatever else they hold', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    // Dispatch offered the first mile to the only driver online — this driver.
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId).toBe(driver.driverProfileId);
    // Now give that same human staff powers: the dual-status case. The reveal
    // must still refuse — the person who must PRODUCE the code never obtains it,
    // matched on the user, exactly like the self-delivery invariant.
    await ctx.prisma.adminPermissionGrant.create({ data: { userId: driver.userId, permission: 'logistics.verify' } });
    const r = await get(driver.cookies, `admin/logistics/legs/${first.id}/handoff-pin`);
    expect(r.status).toBe(403);
  });

  it('refuses to reveal a door-ending leg — that code belongs to the recipient', async () => {
    await makeDriver();
    await setLocalCourierFee(1500n);
    const s = await book(localDoorToDoor());
    const [direct] = await legs(s.id);
    expect(direct!.kind).toBe('DIRECT');
    const verifier = await limitedAdmin(['logistics.verify']);
    const r = await get(verifier.cookies, `admin/logistics/legs/${direct!.id}/handoff-pin`);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/recipient/i);
  });

  it('refuses to reveal a completed leg — a dead code stays dead', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await driveCourierLeg(driver, first.id);
    const verifier = await limitedAdmin(['logistics.verify']);
    const r = await get(verifier.cookies, `admin/logistics/legs/${first.id}/handoff-pin`);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no longer valid/i);
  });

  it("nulls the DIRECT leg's customer-visible PIN once the leg completes", async () => {
    const driver = await makeDriver();
    await setLocalCourierFee(1500n);
    const s = await book(localDoorToDoor());
    const [direct] = await legs(s.id);
    await driveCourierLeg(driver, direct!.id);
    const reference = await referenceOf(s.id);
    const mine = await get(customer, `shipping/${reference}`);
    expect(mine.status).toBe(200);
    expect(mine.body.legs[0].handoffPin).toBeNull();
  });
});

/**
 * Manual assignment — the PRODUCTION dispatch path.
 *
 * `dispatchAutomatic` is deliberately OFF in production, so every test here
 * switches it off first: these legs sit unoffered exactly as they do live, and
 * an administrator hands them to a driver. Every invariant the automatic
 * engine enforces must hold on this path too, because an administrator typing
 * an id by hand is precisely when the checks upstream have NOT already run.
 */
describe('admin manual assignment of a courier leg', () => {
  const vehicleOf = (driverProfileId: string) =>
    ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId }, select: { id: true } });

  it('assigns an unoffered leg by hand, and the driver can accept and work it', async () => {
    await enableDispatch(false);
    const driver = await makeDriver();
    const vehicle = await vehicleOf(driver.driverProfileId);
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    // With automatic dispatch off, nothing has been offered — the live state.
    expect(first.courierStatus).toBeNull();
    expect(first.assignedDriverProfileId).toBeNull();

    const r = await post(admin, `admin/logistics/legs/${first.id}/assign`, {
      driverProfileId: driver.driverProfileId,
      vehicleId: vehicle.id,
    });
    expect(r.status).toBe(201);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.courierStatus).toBe('ASSIGNED');
    expect(after.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(after.assignedVehicleId).toBe(vehicle.id);
    // A human's assignment does not lapse — nothing for the sweeper to expire.
    expect(after.offerExpiresAt).toBeNull();
    // Append-only history got its row.
    const offers = await ctx.prisma.shipmentLegOffer.findMany({ where: { shipmentLegId: first.id } });
    expect(offers).toHaveLength(1);
    expect(offers[0]!.status).toBe('ACTIVE');
    // And it is a real job: the driver can accept it through the ordinary app.
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);
  });

  it("counts a driver's shipment courier legs in the load figure the operator sees", async () => {
    // The eligible-driver pool once counted orderDelivery rows only, so a
    // driver already carrying courier legs showed "0 live jobs" and manual
    // shipping dispatch could stack job after job onto them. Load is one
    // number across BOTH job tables — the rule the automatic ranker
    // (ShipmentDispatchService.rankFor) already applies.
    await enableDispatch(false);
    const driver = await makeDriver();
    const vehicle = await vehicleOf(driver.driverProfileId);

    const sA = await book();
    const firstA = (await legs(sA.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(
      (await post(admin, `admin/logistics/legs/${firstA.id}/assign`, {
        driverProfileId: driver.driverProfileId,
        vehicleId: vehicle.id,
      })).status,
    ).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${firstA.id}/accept`)).status).toBe(201);

    // A second shipment needs a driver. The operator's list must show the
    // courier leg this driver is already holding.
    const sB = await book();
    const firstB = (await legs(sB.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const pool = await get(admin, `admin/logistics/legs/${firstB.id}/eligible-drivers`);
    expect(pool.status).toBe(200);
    const row = pool.body.find((d: { driverProfileId: string }) => d.driverProfileId === driver.driverProfileId);
    expect(row).toBeTruthy();
    expect(row.activeJobs).toBe(1);
  });

  it('reassigns to a second driver, keeping the first assignment as history', async () => {
    await enableDispatch(false);
    const first_driver = await makeDriver();
    const second_driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(
      (await post(admin, `admin/logistics/legs/${first.id}/assign`, {
        driverProfileId: first_driver.driverProfileId,
        vehicleId: (await vehicleOf(first_driver.driverProfileId)).id,
      })).status,
    ).toBe(201);

    const r = await post(admin, `admin/logistics/legs/${first.id}/reassign`, {
      driverProfileId: second_driver.driverProfileId,
      vehicleId: (await vehicleOf(second_driver.driverProfileId)).id,
      reason: 'First driver called in unavailable.',
    });
    expect(r.status).toBe(201);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.assignedDriverProfileId).toBe(second_driver.driverProfileId);
    const offers = await ctx.prisma.shipmentLegOffer.findMany({
      where: { shipmentLegId: first.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(offers.map((o) => o.status)).toEqual(['REASSIGNED', 'ACTIVE']);
  });

  it('refuses to assign the sender to courier their own parcel', async () => {
    await enableDispatch(false);
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    // Promote THIS shipment's sender to a fully approved, online driver — the
    // same human, wearing another role. The refusal must match on the user.
    const senderId = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id } })).customerUserId!;
    await ctx.prisma.userRole.upsert({
      where: { userId_roleCode: { userId: senderId, roleCode: 'DELIVERY_DRIVER' } },
      create: { userId: senderId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED', approvedAt: new Date() },
    });
    const senderProfile = await ctx.prisma.driverProfile.create({
      data: {
        userId: senderId, legalName: 'Sender Moonlighting', displayName: 'SenderDrv', phone: '+5016000001',
        homeDistrict: 'STANN_CREEK', licenceNumber: `SELF-${uniq()}`, licenceExpiry: FUTURE,
        vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
      },
    });
    const senderVehicle = await ctx.prisma.driverVehicle.create({
      data: {
        driverProfileId: senderProfile.id, type: 'CAR', make: 'Honda', model: 'Fit',
        licencePlate: `SELF-${uniq()}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
        isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
      },
    });
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: senderProfile.id, district: 'STANN_CREEK', isActive: true } });

    const r = await post(admin, `admin/logistics/legs/${first.id}/assign`, {
      driverProfileId: senderProfile.id,
      vehicleId: senderVehicle.id,
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/own parcel/i);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId).toBeNull();
  });

  it('refuses a test driver for a real shipment, even from an administrator', async () => {
    await enableDispatch(false);
    const testDriver = await makeDriver({ isTest: true });
    const vehicle = await vehicleOf(testDriver.driverProfileId);
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const r = await post(admin, `admin/logistics/legs/${first.id}/assign`, {
      driverProfileId: testDriver.driverProfileId,
      vehicleId: vehicle.id,
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/test driver/i);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId).toBeNull();
  });

  it('refuses to assign an unpaid shipment to anybody', async () => {
    await enableDispatch(false);
    const driver = await makeDriver();
    const vehicle = await vehicleOf(driver.driverProfileId);
    // Booked WITHOUT payWithWallet: a real booking a customer abandoned unpaid.
    const r0 = await post(customer, 'shipping', doorToDoor());
    expect(r0.status).toBe(201);
    const first = (await legs(r0.body.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const r = await post(admin, `admin/logistics/legs/${first.id}/assign`, {
      driverProfileId: driver.driverProfileId,
      vehicleId: vehicle.id,
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/paid/i);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId).toBeNull();
  });
});

/**
 * BMPL-180: courier and vehicle identification for the customer, once a
 * courier is actually assigned. No new record — this is a customer-safe read
 * of the same assignedDriverProfileId/assignedVehicleId link the driver app
 * already uses to run the leg.
 */
describe('courier and vehicle identification (BMPL-180)', () => {
  const vehicleOf = (driverProfileId: string) => ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId } });

  it('has no courier or vehicle for a leg nobody has been sent on yet', async () => {
    await makeDriver();
    const s = await book();
    const view = await get(customer, `shipping/${s.reference}`);
    const last = view.body.legs.find((l: { kind: string }) => l.kind === 'LAST_MILE');
    expect(last.courier).toBeNull();
    expect(last.courierVehicle).toBeNull();
  });

  it('shows the assigned courier and vehicle once dispatch has picked someone', async () => {
    const driver = await makeDriver();
    const s = await book();
    const vehicle = await vehicleOf(driver.driverProfileId);
    const view = await get(customer, `shipping/${s.reference}`);
    const first = view.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');

    expect(first.courier).not.toBeNull();
    expect(first.courier.displayName).toMatch(/^Drv/);
    expect(first.courier.avatarUrl).toBeNull(); // no approved user avatar in this fixture
    // Never legal name, phone, or documents — display name only.
    expect(first.courier).not.toHaveProperty('phone');
    expect(first.courier).not.toHaveProperty('legalName');

    expect(first.courierVehicle).toEqual({
      type: vehicle.type,
      make: vehicle.make,
      model: vehicle.model,
      color: vehicle.color,
      licencePlate: vehicle.licencePlate,
      photoUrl: null, // no photoKeys in this fixture
    });
    expect(first.courierVehicle).not.toHaveProperty('registrationNumber');
    expect(first.courierVehicle).not.toHaveProperty('insuranceProvider');
  });

  it('exposes the vehicle photo only once the vehicle itself has cleared review', async () => {
    const driver = await makeDriver();
    const s = await book();
    const vehicle = await vehicleOf(driver.driverProfileId);
    await ctx.prisma.driverVehicle.update({
      where: { id: vehicle.id },
      data: { photoKeys: ['driver-vehicle-photo/bmpl180-fixture/car.jpg'], approvalStatus: 'PENDING' },
    });

    let view = await get(customer, `shipping/${s.reference}`);
    let first = view.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(first.courierVehicle.photoUrl).toBeNull();

    await ctx.prisma.driverVehicle.update({ where: { id: vehicle.id }, data: { approvalStatus: 'APPROVED' } });

    view = await get(customer, `shipping/${s.reference}`);
    first = view.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(typeof first.courierVehicle.photoUrl).toBe('string');
    expect(first.courierVehicle.photoUrl).toMatch(/^https?:\/\//);
  });

  it('does not let an unrelated customer read the courier identity off someone else\'s shipment', async () => {
    await makeDriver();
    const s = await book();
    const other = await registerUser(`bmpl180_other_${uniq()}@example.com`);
    const r = await get(other.cookies, `shipping/${s.reference}`);
    // Same "not found" the whole-shipment boundary already returns — a
    // courier-identity leak is exactly the kind of thing that boundary exists
    // to stop, so this pins it for this field specifically rather than relying
    // on the generic shipment test to notice if it ever regressed.
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty('legs');
  });
});
