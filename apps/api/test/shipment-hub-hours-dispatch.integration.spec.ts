/**
 * BMPL-273: the first consumer of hub operating hours (BMPL-262/263/271).
 *
 * The owner's ruling (BMPL-177), read literally: when a first-mile courier's
 * projected arrival at the destination terminal would land outside that
 * terminal's configured hours, WARN AND SCHEDULE INTO A FUTURE OPEN WINDOW —
 * never refuse outright, and never silently proceed as if nothing were
 * wrong. `dispatchLeg` is called repeatedly (booking, leg completion, driver
 * decline, and a 20s sweeper) so "reschedule" needs no persisted state of its
 * own: a leg that is not yet dispatchable is simply left undispatched, and
 * the very next call — with a later `now` — re-evaluates it.
 *
 * Two things this file exists specifically to prove, per the card:
 *  - an UNCONFIGURED hub (every hub in production today) produces the
 *    IDENTICAL outcome as before this card — not merely "no error thrown".
 *  - the deferral and the self-correcting re-dispatch actually HAPPEN, not
 *    just "nothing broke": a consumer that silently does nothing passes
 *    every test that only checks for absence of breakage.
 *
 * Out of scope, deliberately: LAST_MILE and DIRECT never touch a hub
 * (route-planner.ts never sets a destinationHubId for either), so neither has
 * anything for this check to evaluate — that asymmetry is BMPL-260's, not a
 * gap here. No checkout gating, no schema change, no UI.
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

/** Belize is a fixed UTC-6, no DST (belize-time.ts). 2026-11-02 is a Monday. */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

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

async function onlineDriver(districts: string[]) {
  const { userId } = await registerUser(`drv_${uniq()}@example.com`);
  return driverFor(userId, districts);
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'BMPL-273 test fixture.' });
  return { cookies, userId };
}

async function seedNetwork() {
  const hubs = [
    { code: 'PHH', name: 'Placencia Airstrip (hours test)', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
    { code: 'SPH', name: 'San Pedro Airstrip (hours test)', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: `${h.code}${uniq()}`.slice(0, 12), name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  expect(
    (
      await post(admin, 'admin/logistics/routes', {
        originHubId: hub.PHH, destinationHubId: hub.SPH, mode: 'AIR',
        durationMinutes: 20, priceMinor: 6000, carrierName: 'Tropic Air',
      })
    ).status,
  ).toBe(201);
}

async function enableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
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

/** Books with no driver online, so the booking-time auto-dispatch attempt
 *  leaves the leg unassigned regardless of the real wall clock or hub hours
 *  — the test then drives `dispatchLeg` itself with a controlled `now`. */
async function bookUndispatched(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  const firstMile = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id, kind: 'FIRST_MILE' } });
  expect(firstMile.assignedDriverProfileId).toBeNull();
  return { shipmentId: r.body.id as string, firstMileId: firstMile.id as string };
}

/** All 7 days, the same window — only the time-of-day boundary matters here. */
async function setHubHours(hubId: string, openTime: string, closeTime: string) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime, closeTime }));
  expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days })).status).toBe(200);
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
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

describe('shipping dispatch — hub arrival feasibility (BMPL-273)', () => {
  it('an UNCONFIGURED destination hub dispatches exactly as before this card', async () => {
    const sender = await fundedSender();
    const { firstMileId } = await bookUndispatched(sender.cookies);
    const courier = await onlineDriver(['STANN_CREEK']);

    const outcome = await dispatch.dispatchLeg(firstMileId);
    expect(outcome.result).toBe('OFFERED');
    expect((outcome as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMileId } });
    expect(leg.assignedDriverProfileId).toBe(courier.driverProfileId);
    expect(leg.courierStatus).toBe('ASSIGNED');
  });

  it('defers (never offers) when projected arrival is outside configured hours, and re-dispatches on its own once a later `now` lands inside the next open window', async () => {
    await setHubHours(hub.PHH!, '08:00', '17:00');
    const sender = await fundedSender();
    const { firstMileId } = await bookUndispatched(sender.cookies);
    const courier = await onlineDriver(['STANN_CREEK']);

    // Monday 19:00 Belize local — two hours after the terminal locks up.
    const outsideHours = belizeInstant(2026, 11, 2, 19, 0);
    const deferred = await dispatch.dispatchLeg(firstMileId, outsideHours);
    expect(deferred.result).toBe('DEFERRED');
    expect((deferred as { reason: string }).reason).toMatch(/outside its configured hours/);

    // The warning changed nothing: no driver was contacted, no offer budget spent.
    const stillWaiting = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMileId } });
    expect(stillWaiting.assignedDriverProfileId).toBeNull();
    expect(stillWaiting.courierStatus).not.toBe('ASSIGNED');
    expect(stillWaiting.offerCount).toBe(0);
    expect(await ctx.prisma.shipmentLegOffer.count({ where: { shipmentLegId: firstMileId } })).toBe(0);

    // Tuesday 09:00 Belize local — inside the same configured window. Same
    // leg, same call, only `now` has moved forward — exactly what the real
    // 20s sweeper does tick after tick.
    const insideHours = belizeInstant(2026, 11, 3, 9, 0);
    const offered = await dispatch.dispatchLeg(firstMileId, insideHours);
    expect(offered.result).toBe('OFFERED');
    expect((offered as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);

    const dispatched = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMileId } });
    expect(dispatched.assignedDriverProfileId).toBe(courier.driverProfileId);
    expect(dispatched.courierStatus).toBe('ASSIGNED');
  });

  it('projects arrival as now + the leg\'s own durationMinutes, not just whether the hub is open right now', async () => {
    await setHubHours(hub.PHH!, '08:00', '17:00');
    const sender = await fundedSender();
    const { firstMileId } = await bookUndispatched(sender.cookies);
    await onlineDriver(['STANN_CREEK']);

    // 15:30 Belize local is itself inside the window, but +120 minutes lands
    // at 17:30 — ten minutes after close. A naive "is it open right now"
    // check would wrongly offer this leg.
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMileId }, data: { durationMinutes: 120 } });
    const late = await dispatch.dispatchLeg(firstMileId, belizeInstant(2026, 11, 2, 15, 30));
    expect(late.result).toBe('DEFERRED');

    // Conversely, 07:30 is itself BEFORE opening, but +60 minutes lands at
    // 08:30 — inside the window. The leg should dispatch immediately, not
    // wait for 08:00 to arrive on the wall clock.
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMileId }, data: { durationMinutes: 60 } });
    const early = await dispatch.dispatchLeg(firstMileId, belizeInstant(2026, 11, 2, 7, 30));
    expect(early.result).toBe('OFFERED');
  });
});
