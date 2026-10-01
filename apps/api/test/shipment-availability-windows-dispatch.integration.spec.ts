/**
 * BMPL-287: the second consumer of hub-hours' dispatch-deferral machinery
 * (BMPL-273/275) — this time for the sender/recipient availability windows
 * stored by BMPL-285, not a hub's opening hours.
 *
 * Same ruling, same mechanism, reused rather than duplicated: DEFERRED, no
 * persisted "scheduled for" state (the sweeper's existing cadence is what
 * makes it self-correct), and the SAME SHIPMENT_LEG_DISPATCH_DEFERRED audit
 * action as hub hours — a window deferral and an hours deferral are the
 * same operational event to an operator, distinguished only in `reason`
 * and the `cause` field, never a second action value.
 *
 * UNLIKE hub hours, this is NOT FIRST_MILE-only: a hub is never a
 * LAST_MILE destination, but a recipient's own door always is, and DIRECT
 * touches BOTH parties within the SAME leg at two different instants — the
 * sender at `now` (the projected pickup instant), the recipient at
 * `now + durationMinutes` (the projected delivery instant).
 *
 * What this file exists specifically to prove, matching BMPL-273's own
 * standard:
 *  - a shipment with NO configured windows (every shipment in production
 *    today) dispatches with the IDENTICAL outcome as before this card.
 *  - a configured window that the projected instant falls outside DEFERS,
 *    and the same leg self-corrects once a later `now` lands inside it.
 *  - an OVERNIGHT window (22:00-02:00) is handled deliberately — matching
 *    both sides of midnight — not refused and not silently never-matching.
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
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
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

async function onlineDriver(districts: string[]) {
  const s = uniq();
  const { userId } = await registerUser(`drv_${s}@example.com`);
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

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'BMPL-287 test fixture.' });
  return { cookies, userId };
}

async function seedNetwork() {
  const hubs = [
    { code: 'AWD1', name: 'BMPL-287 Placencia', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
    { code: 'AWD2', name: 'BMPL-287 San Pedro', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
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
        originHubId: hub.AWD1, destinationHubId: hub.AWD2, mode: 'AIR',
        durationMinutes: 20, priceMinor: 6000, carrierName: 'Tropic Air',
      })
    ).status,
  ).toBe(201);
}

async function enableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = {
    dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3,
    localCourierFeeMinor: 1000n, localCourierMinutes: 45,
  };
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

/** Same district, same town, no hub network — isLocalDoorToDoor gives a
 *  single DIRECT leg, the case touching BOTH parties in one leg. */
const localDoorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '1 Main St', name: 'Sender', phone: '501-2223333', latitude: 18.0833, longitude: -88.5667 },
  destination: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '2 Main St', name: 'Recipient', phone: '501-4445555', latitude: 18.0840, longitude: -88.5670 },
  description: 'One box, across town',
});

/** Books with no driver online, so the booking-time auto-dispatch attempt
 *  leaves the leg unassigned regardless of the real wall clock or any
 *  configured window — the test then drives `dispatchLeg` itself. */
async function bookUndispatched(cookies: string[], body: Record<string, unknown>) {
  const r = await post(cookies, 'shipping', { ...body, payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body as { id: string; reference: string };
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function setWindows(shipmentId: string, cookies: string[], windows: Array<{ role: string; startTime: string; endTime: string }>) {
  expect((await put(cookies, `shipping/${shipmentId}/availability-windows`, { windows })).status).toBe(200);
}

/** Fast-forward a shipment's earlier legs to COMPLETED directly, so its
 *  LAST_MILE leg is actionable without driving the whole real journey
 *  through the driver app — that mechanics is already covered by
 *  self-courier.integration.spec.ts; this file's focus is the window check
 *  on the leg that is already dispatchable. */
async function fastForwardToLastMile(legs: Array<{ id: string; kind: string }>) {
  const firstMile = legs.find((l) => l.kind === 'FIRST_MILE')!;
  const lineHaul = legs.find((l) => l.kind === 'LINE_HAUL')!;
  await ctx.prisma.shipmentLeg.update({ where: { id: firstMile.id }, data: { status: 'COMPLETED', courierStatus: 'DELIVERED' } });
  await ctx.prisma.shipmentLeg.update({ where: { id: lineHaul.id }, data: { status: 'COMPLETED', arrivedAt: new Date() } });
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

describe('shipping dispatch — availability window feasibility (BMPL-287)', () => {
  it('a shipment with NO configured windows dispatches exactly as before this card', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, doorToDoor());
    const firstMile = (await legsOf(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const courier = await onlineDriver(['STANN_CREEK']);

    const outcome = await dispatch.dispatchLeg(firstMile.id);
    expect(outcome.result).toBe('OFFERED');
    expect((outcome as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);
  });

  it('FIRST_MILE defers on the SENDER window and self-corrects once `now` lands inside it', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, doorToDoor());
    const firstMile = (await legsOf(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const courier = await onlineDriver(['STANN_CREEK']);

    await setWindows(shipment.id, sender.cookies, [{ role: 'SENDER', startTime: '08:00', endTime: '12:00' }]);

    const outside = await dispatch.dispatchLeg(firstMile.id, belizeInstant(2026, 11, 2, 15, 0));
    expect(outside.result).toBe('DEFERRED');
    expect((outside as { reason: string }).reason).toMatch(/sender is outside their configured availability window/);

    const stillWaiting = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id } });
    expect(stillWaiting.assignedDriverProfileId).toBeNull();
    expect(stillWaiting.offerCount).toBe(0);

    const inside = await dispatch.dispatchLeg(firstMile.id, belizeInstant(2026, 11, 2, 9, 0));
    expect(inside.result).toBe('OFFERED');
    expect((inside as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);

    const deferralRows = await ctx.prisma.auditLog.findMany({
      where: { action: 'SHIPMENT_LEG_DISPATCH_DEFERRED', newValue: { path: ['legId'], equals: firstMile.id } },
    });
    expect(deferralRows).toHaveLength(1);
    expect((deferralRows[0]!.newValue as { cause: string }).cause).toBe('AVAILABILITY_WINDOW');
  });

  it('LAST_MILE defers on the RECIPIENT window, projecting the DELIVERY instant (now + durationMinutes), and self-corrects', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, doorToDoor());
    const legs = await legsOf(shipment.id);
    const lastMile = legs.find((l) => l.kind === 'LAST_MILE')!;
    const courier = await onlineDriver(['BELIZE']);
    await fastForwardToLastMile(legs);

    await setWindows(shipment.id, sender.cookies, [{ role: 'RECIPIENT', startTime: '13:00', endTime: '17:00' }]);
    await ctx.prisma.shipmentLeg.update({ where: { id: lastMile.id }, data: { durationMinutes: 60 } });

    // 11:00 + 60min = 12:00 — outside the 13-17 recipient window.
    const outside = await dispatch.dispatchLeg(lastMile.id, belizeInstant(2026, 11, 2, 11, 0));
    expect(outside.result).toBe('DEFERRED');
    expect((outside as { reason: string }).reason).toMatch(/recipient is outside their configured availability window/);

    // 13:00 + 60min = 14:00 — inside the window.
    const inside = await dispatch.dispatchLeg(lastMile.id, belizeInstant(2026, 11, 2, 13, 0));
    expect(inside.result).toBe('OFFERED');
    expect((inside as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);
  });

  it('DIRECT checks the SENDER at `now` and the RECIPIENT at `now + durationMinutes`, WITHIN THE SAME LEG', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, localDoorToDoor());
    const legs = await legsOf(shipment.id);
    expect(legs).toHaveLength(1);
    const direct = legs[0]!;
    const courier = await onlineDriver(['ORANGE_WALK']);

    await ctx.prisma.shipmentLeg.update({ where: { id: direct.id }, data: { durationMinutes: 60 } });
    await setWindows(shipment.id, sender.cookies, [
      { role: 'SENDER', startTime: '08:00', endTime: '12:00' },
      { role: 'RECIPIENT', startTime: '13:00', endTime: '17:00' },
    ]);

    // 07:00: SENDER's 08-12 window has not opened yet — fails on the
    // sender half before the recipient half is ever evaluated.
    const senderFails = await dispatch.dispatchLeg(direct.id, belizeInstant(2026, 11, 2, 7, 0));
    expect(senderFails.result).toBe('DEFERRED');
    expect((senderFails as { reason: string }).reason).toMatch(/sender is outside/);

    // 11:00: sender open (08-12), but +60min = 12:00 is outside the
    // recipient's 13-17 window — the sender half passes, the recipient
    // half is what defers it.
    const recipientFails = await dispatch.dispatchLeg(direct.id, belizeInstant(2026, 11, 2, 11, 0));
    expect(recipientFails.result).toBe('DEFERRED');
    expect((recipientFails as { reason: string }).reason).toMatch(/recipient is outside/);

    // Widen the recipient window so an instant exists where BOTH halves
    // hold: 09:00 (sender open) and +60min = 10:00 (now inside recipient's
    // widened window too).
    await setWindows(shipment.id, sender.cookies, [
      { role: 'SENDER', startTime: '08:00', endTime: '12:00' },
      { role: 'RECIPIENT', startTime: '08:30', endTime: '17:00' },
    ]);
    const bothOk = await dispatch.dispatchLeg(direct.id, belizeInstant(2026, 11, 2, 9, 0));
    expect(bothOk.result).toBe('OFFERED');
    expect((bothOk as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);
  });

  it('an OVERNIGHT recipient window (22:00-02:00) is handled deliberately, not refused and not silently never-matching', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, doorToDoor());
    const legs = await legsOf(shipment.id);
    const lastMile = legs.find((l) => l.kind === 'LAST_MILE')!;
    const lastCourier = await onlineDriver(['BELIZE']);
    await fastForwardToLastMile(legs);

    await setWindows(shipment.id, sender.cookies, [{ role: 'RECIPIENT', startTime: '22:00', endTime: '02:00' }]);
    await ctx.prisma.shipmentLeg.update({ where: { id: lastMile.id }, data: { durationMinutes: 0 } });

    // 12:00 Belize — the daytime gap of an overnight 22:00-02:00 window.
    const daytime = await dispatch.dispatchLeg(lastMile.id, belizeInstant(2026, 11, 2, 12, 0));
    expect(daytime.result).toBe('DEFERRED');

    // 23:00 Belize — before midnight, inside the overnight window.
    const beforeMidnight = await dispatch.dispatchLeg(lastMile.id, belizeInstant(2026, 11, 2, 23, 0));
    expect(beforeMidnight.result).toBe('OFFERED');
    expect((beforeMidnight as { driverProfileId: string }).driverProfileId).toBe(lastCourier.driverProfileId);
  });

  it('a second OVERNIGHT case: after midnight is also inside the window, on a fresh shipment', async () => {
    const sender = await fundedSender();
    const shipment = await bookUndispatched(sender.cookies, doorToDoor());
    const legs = await legsOf(shipment.id);
    const lastMile = legs.find((l) => l.kind === 'LAST_MILE')!;
    const lastCourier = await onlineDriver(['BELIZE']);
    await fastForwardToLastMile(legs);

    await setWindows(shipment.id, sender.cookies, [{ role: 'RECIPIENT', startTime: '22:00', endTime: '02:00' }]);
    await ctx.prisma.shipmentLeg.update({ where: { id: lastMile.id }, data: { durationMinutes: 0 } });

    // 01:00 Belize — after midnight, still inside the overnight window.
    const afterMidnight = await dispatch.dispatchLeg(lastMile.id, belizeInstant(2026, 11, 2, 1, 0));
    expect(afterMidnight.result).toBe('OFFERED');
    expect((afterMidnight as { driverProfileId: string }).driverProfileId).toBe(lastCourier.driverProfileId);
  });
});
