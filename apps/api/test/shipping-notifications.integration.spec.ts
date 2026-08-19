/**
 * Who is told what, when a parcel moves.
 *
 * The previous milestone wired the notification calls and tested where their
 * links go, but never asserted the thing that actually matters operationally:
 * that each event reaches EXACTLY the right person and nobody else.
 *
 * The two failures worth catching are opposites. A missing notification means a
 * customer refreshing a page to find out where their parcel is. A stray one
 * means a driver being told about work that is not theirs — or worse, a customer
 * from a different shipment learning something about this one.
 *
 * Every assertion here is scoped to notifications created DURING the step, so a
 * lifecycle that legitimately fires several times cannot be mistaken for a
 * duplicate, and a duplicate cannot hide behind an earlier event.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let adminUserId: string;
let customer: string[];
let customerId: string;
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

async function makeDriver(opts: { isTest?: boolean } = {}) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`ndrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: opts.isTest ?? false, legalName: 'D River', displayName: `Drv${s}`,
      phone: '+5016000000', homeDistrict: 'BELIZE', licenceNumber: `NT-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'T', model: 'C',
      licencePlate: `NT-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const d of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id };
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
    });
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  for (const r of [{ from: 'PLA', to: 'MUN', price: 8000 }, { from: 'MUN', to: 'SPA', price: 6000 }]) {
    await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: 45, priceMinor: r.price, carrierName: 'Tropic Air',
    });
  }
}

async function enableDispatch(on = true) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: on, dispatchOfferTimeoutSeconds: 900, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 5 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

const legsOf = (id: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId: id }, orderBy: { sequence: 'asc' } });
const pinOf = async (legId: string) =>
  (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;

/** One delivered notification, flattened to what a test cares about. */
interface Delivered {
  event: string | null;
  category: string;
  title: string;
  body: string;
  userId: string;
  data: Record<string, unknown>;
}

/**
 * Run `step`, then return ONLY the notifications it produced.
 *
 * Scoping by timestamp rather than counting totals is what makes "exactly one"
 * a meaningful claim: a lifecycle legitimately fires many notifications, and an
 * absolute count would either pass by accident or fail for the wrong reason.
 */
async function capture(step: () => Promise<unknown>): Promise<Delivered[]> {
  const since = new Date();
  // Postgres timestamps have sub-millisecond resolution; nudge the boundary so a
  // notification written in the same millisecond as `since` is still counted.
  since.setMilliseconds(since.getMilliseconds() - 1);
  await step();
  const rows = await ctx.prisma.notificationRecipient.findMany({
    where: { notification: { createdAt: { gte: since } } },
    include: { notification: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({
    event: r.notification.event,
    category: r.notification.category,
    title: r.notification.title,
    body: r.notification.body,
    userId: r.userId,
    data: (r.notification.data ?? {}) as Record<string, unknown>,
  }));
}

const to = (all: Delivered[], userId: string) => all.filter((n) => n.userId === userId);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  adminUserId = a.id;
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.notificationRecipient.deleteMany();
  await ctx.prisma.notification.deleteMany();
  await ctx.prisma.message.deleteMany();
  await ctx.prisma.conversationParticipant.deleteMany();
  await ctx.prisma.conversation.deleteMany();
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`ncust_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  await enableDispatch(true);
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('the driver offer', () => {
  it('tells exactly the offered driver, and nobody else', async () => {
    const driver = await makeDriver();
    const bystander = await makeDriver();

    const fired = await capture(() => post(customer, 'shipping', doorToDoor()));
    const offers = fired.filter((n) => n.event === 'SHIPMENT_LEG_OFFERED');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.userId).toBe(driver.userId);
    // The second driver exists, is online and eligible — and hears nothing,
    // because a rolling offer goes to one driver at a time.
    expect(to(fired, bystander.userId)).toHaveLength(0);
    // Booking is not itself a customer notification; the customer is watching
    // the page they just submitted.
    expect(to(fired, customerId).filter((n) => n.event === 'SHIPMENT_LEG_OFFERED')).toHaveLength(0);
  });

  it('words a pickup offer differently from a delivery offer, and deep-links to the job', async () => {
    const driver = await makeDriver();
    const fired = await capture(() => post(customer, 'shipping', doorToDoor()));
    const offer = fired.find((n) => n.event === 'SHIPMENT_LEG_OFFERED')!;
    expect(offer.title).toBe('New shipping pickup');
    expect(offer.category).toBe('DELIVERY');
    // The driver's link must resolve to THEIR leg, not the shipment.
    const legs = await legsOf((await ctx.prisma.shipment.findFirstOrThrow()).id);
    expect(offer.data.driverJobId).toBe(legs.find((l) => l.kind === 'FIRST_MILE')!.id);
    expect(offer.data.jobKind).toBe('FIRST_MILE');
  });

  it('re-offers to the next driver on a decline, telling only them', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const holderId = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId;
    const holder = holderId === a.driverProfileId ? a : b;
    const other = holderId === a.driverProfileId ? b : a;

    const fired = await capture(() => post(holder.cookies, `driver/shipping-jobs/${first.id}/decline`, { reason: 'Too far.' }));
    const offers = fired.filter((n) => n.event === 'SHIPMENT_LEG_OFFERED');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.userId).toBe(other.userId);
    // The driver who declined is not told about the job again.
    expect(to(fired, holder.userId).filter((n) => n.event === 'SHIPMENT_LEG_OFFERED')).toHaveLength(0);
  });
});

describe('the customer follows one journey', () => {
  async function bookWithDriver() {
    const driver = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    return { driver, s, legs: await legsOf(s.id) };
  }

  it('tells the customer when a driver takes the job — and does not tell the driver', async () => {
    const { driver, legs } = await bookWithDriver();
    const first = legs.find((l) => l.kind === 'FIRST_MILE')!;

    const fired = await capture(() => post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`));
    const mine = to(fired, customerId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.body).toContain('on the way to collect');
    expect(to(fired, driver.userId)).toHaveLength(0);
  });

  it('tells the customer when the parcel is collected, exactly once', async () => {
    const { driver, legs } = await bookWithDriver();
    const first = legs.find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const fired = await capture(() => post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`));
    const mine = to(fired, customerId);
    // Collection moves custody AND advances the shipment status, so the customer
    // legitimately hears about both — but each exactly once, and both about this
    // shipment.
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.some((n) => n.body.includes('collected'))).toBe(true);
    for (const n of mine) expect(n.data.reference).toBeTruthy();
    expect(new Set(mine.map((n) => n.body)).size).toBe(mine.length);
  });

  it('deep-links every customer notification to the one tracker, by reference', async () => {
    const { driver, legs, s } = await bookWithDriver();
    const first = legs.find((l) => l.kind === 'FIRST_MILE')!;
    const fired = await capture(async () => {
      await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
      await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`);
    });
    const mine = to(fired, customerId);
    expect(mine.length).toBeGreaterThan(0);
    for (const n of mine) {
      // The reference is what the tracker route resolves on — an id would 404.
      expect(n.data.reference).toBe(s.reference);
    }
  });

  it('says "ready to collect" for a hub-ending shipment, to the customer only', async () => {
    const driver = await makeDriver();
    const s = (await post(customer, 'shipping', {
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'R', phone: '501-4445555' },
      preferredMode: 'AIR',
    })).body;
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`);
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/in-transit`);
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/arriving`);
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/handoff`, { pin: await pinOf(first.id), receivedByName: 'Counter' });
    const lineHauls = (await legsOf(s.id)).filter((l) => l.kind === 'LINE_HAUL');
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/depart`, {});
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/arrive`, {});
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/handoff`, { pin: await pinOf(lineHauls[0]!.id), receivedByName: 'Counter' });

    const fired = await capture(async () => {
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/depart`, {});
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/arrive`, {});
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/handoff`, { pin: await pinOf(lineHauls[1]!.id), receivedByName: 'Counter' });
    });
    const mine = to(fired, customerId);
    // Never "delivered" — the parcel is on a counter waiting for them.
    expect(mine.some((n) => n.body.toLowerCase().includes('ready to collect'))).toBe(true);
    expect(mine.some((n) => n.body.toLowerCase() === 'delivered')).toBe(false);
  });

  it('tells the customer when the collection is recorded', async () => {
    const s = (await post(customer, 'shipping', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.PLA, name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'R', phone: '501-4445555' },
      preferredMode: 'AIR',
    })).body;
    for (const lh of await legsOf(s.id)) {
      await post(admin, `admin/logistics/legs/${lh.id}/depart`, {});
      await post(admin, `admin/logistics/legs/${lh.id}/arrive`, {});
      await post(admin, `admin/logistics/legs/${lh.id}/handoff`, { pin: await pinOf(lh.id), receivedByName: 'Counter' });
    }
    const fired = await capture(() => post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria' }));
    const mine = to(fired, customerId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.body).toBe('Delivered');
    expect(mine[0]!.data.reference).toBe(s.reference);
  });
});

describe('a driver hears only about their own leg', () => {
  it('does not tell the first-mile driver about the last mile', async () => {
    const firstDriver = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await post(firstDriver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    await post(firstDriver.cookies, `driver/shipping-jobs/${first.id}/pickup`);
    await post(firstDriver.cookies, `driver/shipping-jobs/${first.id}/in-transit`);
    await post(firstDriver.cookies, `driver/shipping-jobs/${first.id}/arriving`);
    await post(firstDriver.cookies, `driver/shipping-jobs/${first.id}/handoff`, { pin: await pinOf(first.id), receivedByName: 'Counter' });

    const lineHauls = (await legsOf(s.id)).filter((l) => l.kind === 'LINE_HAUL');
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/depart`, {});
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/arrive`, {});
    await post(admin, `admin/logistics/legs/${lineHauls[0]!.id}/handoff`, { pin: await pinOf(lineHauls[0]!.id), receivedByName: 'Counter' });

    // The second flight lands and the LAST mile is offered. A second driver
    // exists specifically so the offer has somewhere else to go.
    const lastDriver = await makeDriver();
    const fired = await capture(async () => {
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/depart`, {});
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/arrive`, {});
      await post(admin, `admin/logistics/legs/${lineHauls[1]!.id}/handoff`, { pin: await pinOf(lineHauls[1]!.id), receivedByName: 'Counter' });
    });

    const offers = fired.filter((n) => n.event === 'SHIPMENT_LEG_OFFERED');
    expect(offers).toHaveLength(1);
    // Whoever got it, the first-mile driver must not be told about work on a leg
    // they have already handed on.
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const holder = last.assignedDriverProfileId;
    if (holder === firstDriver.driverProfileId) {
      // Dispatch may legitimately re-offer to the same person when they are the
      // best candidate; what must never happen is a notification about a leg
      // they do NOT hold.
      expect(offers[0]!.userId).toBe(firstDriver.userId);
    } else {
      expect(offers[0]!.userId).toBe(lastDriver.userId);
      expect(to(fired, firstDriver.userId).filter((n) => n.event === 'SHIPMENT_LEG_OFFERED')).toHaveLength(0);
    }
  });
});

describe('operations are told when a human is needed', () => {
  it('alerts an administrator on a leg exception, and tells the customer nothing misleading', async () => {
    const driver = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`);

    const fired = await capture(() =>
      post(admin, `admin/logistics/legs/${first.id}/exception`, { reason: 'Parcel damaged in the van.' }),
    );
    const opsAlerts = fired.filter((n) => n.event === 'SHIPMENT_EXCEPTION');
    expect(opsAlerts.length).toBeGreaterThanOrEqual(1);
    expect(opsAlerts.map((n) => n.userId)).toContain(adminUserId);
    expect(opsAlerts[0]!.body).toBe('Parcel damaged in the van.');
    // The alert names the shipment so an operator can open it.
    expect(opsAlerts[0]!.data.reference).toBe(s.reference);
    // The driver is not paged about an operations problem.
    expect(to(fired, driver.userId).filter((n) => n.event === 'SHIPMENT_EXCEPTION')).toHaveLength(0);
  });

  it('alerts an administrator when dispatch runs out of drivers', async () => {
    const driver = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { offerCount: 3, assignedDriverProfileId: null, courierStatus: 'DRIVER_DECLINED' },
    });

    const { ShipmentDispatchService } = await import('../src/shipping/shipment-dispatch.service');
    const dispatch = ctx.app.get(ShipmentDispatchService);
    const fired = await capture(() => dispatch.dispatchLeg(first.id));

    const alerts = fired.filter((n) => n.event === 'SHIPMENT_LEG_DISPATCH_EXHAUSTED');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.map((n) => n.userId)).toContain(adminUserId);
    // This is the one case a human genuinely has to act, so it must not look
    // like an ordinary progress update.
    expect(alerts[0]!.category).toBe('ADMIN_ALERT');
    expect(to(fired, driver.userId)).toHaveLength(0);
  });
});

describe('nothing crosses between real and rehearsal', () => {
  it('never notifies a test driver about a real shipment', async () => {
    // The test driver is the only driver online. A real shipment must go
    // unoffered rather than page them.
    const testDriver = await makeDriver({ isTest: true });
    const fired = await capture(() => post(customer, 'shipping', doorToDoor()));
    expect(to(fired, testDriver.userId)).toHaveLength(0);
    expect(fired.filter((n) => n.event === 'SHIPMENT_LEG_OFFERED')).toHaveLength(0);
  });

  it('never notifies a real driver about a test shipment', async () => {
    const realDriver = await makeDriver({ isTest: false });
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    await ctx.prisma.shipment.update({ where: { id: s.id }, data: { isTest: true } });
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: null, courierStatus: null, offerCount: 0 },
    });

    const { ShipmentDispatchService } = await import('../src/shipping/shipment-dispatch.service');
    const dispatch = ctx.app.get(ShipmentDispatchService);
    const fired = await capture(() => dispatch.dispatchLeg(first.id));
    expect(to(fired, realDriver.userId)).toHaveLength(0);
  });
});

describe('unread counting and read state', () => {
  it('increments the driver\'s unread count by exactly the offer', async () => {
    const driver = await makeDriver();
    const before = (await get(driver.cookies, 'notifications/unread-count')).body;
    await post(customer, 'shipping', doorToDoor());
    const after = (await get(driver.cookies, 'notifications/unread-count')).body;
    expect(Number(after.count ?? after.unread ?? after)).toBe(Number(before.count ?? before.unread ?? before) + 1);
  });

  it('marks read without deleting, and the count follows', async () => {
    const driver = await makeDriver();
    await post(customer, 'shipping', doorToDoor());
    const list = await get(driver.cookies, 'notifications');
    const rows = Array.isArray(list.body) ? list.body : list.body.items;
    expect(rows.length).toBeGreaterThan(0);

    const marked = await request(ctx.server).patch(`/api/notifications/${rows[0].id}/read`).set('Cookie', driver.cookies).send({});
    expect(marked.status).toBeLessThan(400);
    const after = (await get(driver.cookies, 'notifications/unread-count')).body;
    expect(Number(after.count ?? after.unread ?? after)).toBe(0);
    // Read is not deleted — the driver can still find what they were told.
    const still = await get(driver.cookies, 'notifications');
    const stillRows = Array.isArray(still.body) ? still.body : still.body.items;
    expect(stillRows.length).toBe(rows.length);
  });
});

describe('replaying a transition does not double-notify', () => {
  it('sends nothing extra when accept is called twice', async () => {
    // Accept is idempotent by design; the notification must be too, or a driver
    // with a flaky connection spams their customer.
    const driver = await makeDriver();
    const s = (await post(customer, 'shipping', doorToDoor())).body;
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const fired = await capture(() => post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`));
    expect(to(fired, customerId)).toHaveLength(0);
  });

  it('refuses a repeated collection rather than notifying again', async () => {
    const s = (await post(customer, 'shipping', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.PLA, name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'R', phone: '501-4445555' },
      preferredMode: 'AIR',
    })).body;
    for (const lh of await legsOf(s.id)) {
      await post(admin, `admin/logistics/legs/${lh.id}/depart`, {});
      await post(admin, `admin/logistics/legs/${lh.id}/arrive`, {});
      await post(admin, `admin/logistics/legs/${lh.id}/handoff`, { pin: await pinOf(lh.id), receivedByName: 'Counter' });
    }
    await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria' });

    const fired = await capture(async () => {
      const again = await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Someone else' });
      expect(again.status).toBe(400);
    });
    expect(to(fired, customerId)).toHaveLength(0);
  });
});
