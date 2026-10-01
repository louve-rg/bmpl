/**
 * BMPL-345, owner ruling 11: notify the customer when a shipment's own ETA
 * moves materially — at least `SHIPMENT_ETA_CHANGE_THRESHOLD_MINUTES` (default
 * 30) from the last instant they were told about.
 *
 * Reuses transport-leg-operations.integration.spec.ts's own network (two
 * water-taxi terminals, one 90-minute SEA route) and its `book()`/
 * `bookedWithFirstMileDone()` shape — the LINE_HAUL leg is the only thing an
 * operator can `schedule()` a real commitment onto (BMPL-346), which is also
 * the only lever this file needs to move the shipment's overall ETA.
 *
 * Every assertion is scoped to notifications created DURING the step under
 * test (shipping-notifications.integration.spec.ts's own `capture()`
 * pattern), so a lifecycle that fires more than once elsewhere in the test
 * cannot be mistaken for the thing being asserted here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

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
  const { cookies, userId } = await registerUser(`edrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'E Driver', displayName: `Edr${s}`, phone: '+5016000001', homeDistrict: 'BELIZE',
      licenceNumber: `EDL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Hilux',
      licencePlate: `EL-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

async function seedWaterTaxiNetwork() {
  hub = {};
  for (const h of [
    { code: `ESW${uniq()}`.slice(0, 12), name: 'San Pedro Water Taxi Terminal (eta notif)', city: 'San Pedro', fee: 1500, key: 'SPW' },
    { code: `EBW${uniq()}`.slice(0, 12), name: 'Belize City Water Taxi Terminal (eta notif)', city: 'Belize City', fee: 1000, key: 'BZW' },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: h.city, modes: ['LAND', 'SEA'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.key] = r.body.id;
    // Wide open, every day — this file is about the LINE_HAUL leg's own
    // commitment, so the courier legs on either side must resolve to at
    // least PROJECTED on their own, never UNKNOWN, or the overall shipment
    // confidence (the weakest leg) could never leave UNKNOWN regardless of
    // what the LINE_HAUL carries.
    const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime: '00:00', closeTime: '23:59' }));
    expect((await put(admin, `admin/logistics/hubs/${r.body.id}/hours`, { days })).status).toBe(200);
  }
  expect((await post(admin, 'admin/logistics/routes', {
    originHubId: hub.SPW, destinationHubId: hub.BZW, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  })).status).toBe(201);
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

async function book() {
  const r = await post(customer, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: 'San Pedro', address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2229999' },
    destination: { district: 'BELIZE', city: 'Belize City', address: '2 Albert Street', name: 'Recipient', phone: '501-4449999' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

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
async function bookedReadyForLineHaul(driver: Awaited<ReturnType<typeof makeDriver>>) {
  const s = await book();
  const rows = await legsOf(s.id);
  const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, driver)).status).toBe(201);
  await driveCourierLeg(driver, first.id);
  return { shipment: s, lineHaul: (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')! };
}

const schedule = (legId: string, body: object) => post(admin, `admin/logistics/legs/${legId}/schedule`, body);

interface Delivered { event: string | null; userId: string; data: Record<string, unknown> }

/** Run `step`, then return ONLY the notifications it produced — an id-set
 *  diff, not a timestamp, so sub-millisecond clock skew cannot fold a setup
 *  notification into the window being asserted (shipping-notifications.
 *  integration.spec.ts's own documented reason for this exact shape). */
async function capture(step: () => Promise<unknown>): Promise<Delivered[]> {
  const before = new Set((await ctx.prisma.notificationRecipient.findMany({ select: { id: true } })).map((r) => r.id));
  await step();
  const rows = (await ctx.prisma.notificationRecipient.findMany({ include: { notification: true }, orderBy: { id: 'asc' } }))
    .filter((r) => !before.has(r.id));
  return rows.map((r) => ({ event: r.notification.event, userId: r.userId, data: (r.notification.data ?? {}) as Record<string, unknown> }));
}

const etaChanges = (all: Delivered[]) => all.filter((n) => n.event === 'SHIPMENT_ETA_CHANGED');

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  // Exercised once, to prove the gate — every other test in this file uses
  // the full-permission `admin` session, matching transport-leg-operations'
  // own split (a read-only pair proves nothing by itself, repeated).
  void (await seedLimitedAdmin(ctx.prisma, `eronly_${uniq()}@example.com`, ['logistics.read']));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.notificationRecipient.deleteMany();
  await ctx.prisma.notification.deleteMany();
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
  const c = await registerUser(`ecust_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'BMPL-345 fixture.' });
  await disableDispatch();
  await seedWaterTaxiNetwork();
});

describe('shipment ETA-change notification (BMPL-345)', () => {
  it('the first time the ETA becomes knowable, it establishes the baseline SILENTLY — nothing to compare a first value against', async () => {
    const driver = await makeDriver();
    const { lineHaul, shipment } = await bookedReadyForLineHaul(driver);

    const delivered = await capture(async () => {
      const r = await schedule(lineHaul.id, { scheduledArrivalAt: new Date(Date.now() + 4 * 3600_000).toISOString() });
      expect(r.status).toBe(201);
      expect(r.body.eta.confidence).not.toBe('UNKNOWN');
      expect(r.body.eta.estimatedArrivalAt).not.toBeNull();
    });

    expect(etaChanges(delivered)).toHaveLength(0);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt).not.toBeNull();
  });

  it('a move JUST UNDER the threshold neither notifies nor moves the baseline', async () => {
    const driver = await makeDriver();
    const { lineHaul, shipment } = await bookedReadyForLineHaul(driver);
    const first = new Date(Date.now() + 4 * 3600_000);
    expect((await schedule(lineHaul.id, { scheduledArrivalAt: first.toISOString() })).status).toBe(201);
    const baseline = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).etaBaselineAt!;
    expect(baseline.getTime()).toBe(first.getTime());

    const delivered = await capture(async () => {
      const nudged = new Date(first.getTime() + 29 * 60_000); // 29 minutes — just under the 30-minute default
      const r = await schedule(lineHaul.id, { scheduledArrivalAt: nudged.toISOString() });
      expect(r.status).toBe(201);
    });

    expect(etaChanges(delivered)).toHaveLength(0);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt!.getTime()).toBe(baseline.getTime()); // unchanged — so a later small move still sums against this SAME reference
  });

  it('a move AT OR JUST OVER the threshold notifies the customer with the previous and new arrival instants, and advances the baseline', async () => {
    const driver = await makeDriver();
    const { lineHaul, shipment } = await bookedReadyForLineHaul(driver);
    const first = new Date(Date.now() + 4 * 3600_000);
    expect((await schedule(lineHaul.id, { scheduledArrivalAt: first.toISOString() })).status).toBe(201);

    const delivered = await capture(async () => {
      const moved = new Date(first.getTime() + 30 * 60_000); // exactly the 30-minute default
      const r = await schedule(lineHaul.id, { scheduledArrivalAt: moved.toISOString() });
      expect(r.status).toBe(201);
    });

    const changes = etaChanges(delivered);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.userId).toBe(customerId);
    expect(changes[0]!.data.previousEstimatedArrivalAt).toBe(first.toISOString());
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt!.getTime()).toBe(new Date(first.getTime() + 30 * 60_000).getTime());
  });

  it('several sub-threshold moves still fire once their SUM crosses the threshold, measured against the original baseline', async () => {
    const driver = await makeDriver();
    const { lineHaul, shipment } = await bookedReadyForLineHaul(driver);
    const first = new Date(Date.now() + 4 * 3600_000);
    expect((await schedule(lineHaul.id, { scheduledArrivalAt: first.toISOString() })).status).toBe(201);

    const step1 = await capture(async () => {
      expect((await schedule(lineHaul.id, { scheduledArrivalAt: new Date(first.getTime() + 12 * 60_000).toISOString() })).status).toBe(201);
    });
    expect(etaChanges(step1)).toHaveLength(0);

    const step2 = await capture(async () => {
      // 12 + 19 = 31 minutes from the ORIGINAL baseline, which must be what
      // fires it — each individual step (12, then 19) is under the threshold.
      expect((await schedule(lineHaul.id, { scheduledArrivalAt: new Date(first.getTime() + 31 * 60_000).toISOString() })).status).toBe(201);
    });
    expect(etaChanges(step2)).toHaveLength(1);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt!.getTime()).toBe(new Date(first.getTime() + 31 * 60_000).getTime());
  });

  it('never fires, and never touches the baseline, while the shipment eta is UNKNOWN', async () => {
    // Walk the FIRST_MILE courier leg through its full lifecycle — five real
    // transition() calls (accept/pickup/in-transit/arriving/handoff) — with
    // NO LINE_HAUL commitment ever recorded. The overall shipment eta reads
    // UNKNOWN throughout (BMPL-340's own documented gap: an unstarted
    // LINE_HAUL leg is UNKNOWN until an operator schedules it), so every one
    // of those five triggers must decline to notify and must leave the
    // baseline untouched — the thing the UNKNOWN case actually asks for,
    // proven against a real trigger rather than an absence of one.
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);

    const delivered = await capture(async () => {
      await driveCourierLeg(driver, first.id);
    });

    expect(etaChanges(delivered)).toHaveLength(0);
    const tracked = await get(customer, `shipping/${s.reference}`);
    expect(tracked.body.eta.confidence).toBe('UNKNOWN');
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.etaBaselineAt).toBeNull();
  });
});
