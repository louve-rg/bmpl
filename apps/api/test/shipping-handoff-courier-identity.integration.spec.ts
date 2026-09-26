/**
 * BMPL-174: a handoff code proves the CODE, not the courier — until now.
 *
 * `verifyHandoffPin` (shipment.service.ts) used to check only the code. Any
 * account holding `logistics.operate` who learned a leg's code — overheard,
 * read off a screen, or simply an ops account that is not this leg's driver —
 * could complete ANY courier leg's handoff. This suite proves the fix: for a
 * leg with an assigned courier (FIRST_MILE/LAST_MILE/DIRECT), only the
 * CURRENTLY assigned driver may complete it, even with the right code, and the
 * wrong-courier and wrong-code cases share one failure path and one attempt
 * counter so neither can be told apart from the outside.
 *
 * It also settles, by test rather than by comment, whether a LINE_HAUL
 * (terminal-to-terminal) leg reaches this same check: it does, via the same
 * `admin/logistics/legs/:id/handoff` route the receiving desk always used —
 * but `assignedDriverProfileId` is never set for that leg kind, so the new
 * check is a correct no-op there and the terminal exception stays code-only,
 * exactly as the product owner requires.
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

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
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
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Handoff-identity test fixture.' });
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
async function pinOf(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}

/** Auto-dispatch to the single online courier, then bring the leg through
 * accept/pickup/in-transit/arriving — right up to, but not through, handoff. */
async function driveToInProgress(courier: { cookies: string[] }, legId: string) {
  await dispatch.dispatchLeg(legId);
  const leg = await legRow(legId);
  expect(leg.assignedDriverProfileId).not.toBeNull();
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  return legRow(legId);
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

describe('handoff completion checks the courier, not just the code (BMPL-174)', () => {
  it('1 · wrong code + right courier — still refused, and the attempt counts', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveToInProgress(courier, firstMile.id);

    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: '000000', receivedByName: 'Someone' });
    expect(r.status).toBe(400);

    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.handoffPinAttempts).toBe(1);
  });

  it('2 · right code + wrong courier — an ops account who happens to be a DIFFERENT driver cannot stand in', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveToInProgress(courier, firstMile.id);

    const impostor = await makeOperator(['logistics.operate']);
    const impostorDriverProfileId = await attachDriverProfile(impostor.userId);
    expect(impostorDriverProfileId).not.toBe(courier.driverProfileId);

    const pin = await pinOf(firstMile.id);
    const r = await post(impostor.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, { pin, receivedByName: 'Impostor' });
    expect(r.status).toBe(400);

    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.handoffPinAttempts).toBe(1);

    // No side effect on the real code: the assigned courier still completes it.
    const ok = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Receiver' });
    expect(ok.status).toBe(201);
  });

  it('3 · right code + no driver profile at all — an ops account with no courier identity cannot stand in either', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveToInProgress(courier, firstMile.id);

    const opsOnly = await makeOperator(['logistics.operate']);
    const pin = await pinOf(firstMile.id);
    const r = await post(opsOnly.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, { pin, receivedByName: 'Ops desk' });
    expect(r.status).toBe(400);

    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.handoffPinAttempts).toBe(1);
  });

  it('4 · a consumed code cannot be replayed once the leg is done', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveToInProgress(courier, firstMile.id);
    const pin = await pinOf(firstMile.id);

    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Receiver' })).status).toBe(201);
    const done = await legRow(firstMile.id);
    expect(done.status).toBe('COMPLETED');

    // Replaying it is now a "job not found" for the driver route (no longer
    // owned/actionable); go through the admin route to hit the leg-status
    // guard directly and prove the same code no longer verifies anything.
    const replay = await post(admin, `admin/logistics/legs/${firstMile.id}/handoff`, { pin, receivedByName: 'Replay' });
    expect(replay.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.status).toBe('COMPLETED');
  });

  it('5 · a code that is real, just for a different shipment, does not work here', async () => {
    const senderA = await fundedSender();
    const senderB = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');

    const shipmentA = await book(senderA.cookies);
    const { firstMile: legA } = await journey(shipmentA.id);
    await driveToInProgress(courierA, legA.id);

    const shipmentB = await book(senderB.cookies);
    const { firstMile: legB } = await journey(shipmentB.id);
    await driveToInProgress(courierB, legB.id);

    const foreignPin = await pinOf(legB.id);
    expect(foreignPin).not.toBe(await pinOf(legA.id));

    const r = await post(courierA.cookies, `driver/shipping-jobs/${legA.id}/handoff`, { pin: foreignPin, receivedByName: 'Receiver' });
    expect(r.status).toBe(400);

    const after = await legRow(legA.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.handoffPinAttempts).toBe(1);
  });

  it('6 · terminal-to-terminal (LINE_HAUL) handoff stays code-only, and stays behind logistics.operate', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls } = await journey(shipment.id);
    expect(lineHauls.length).toBeGreaterThan(0);
    const lineHaul = lineHauls[0]!;
    expect(lineHaul.assignedDriverProfileId).toBeNull();

    // Get the parcel to the terminal legitimately, then move the transport leg.
    await driveToInProgress(courier, firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: await pinOf(firstMile.id), receivedByName: 'Terminal desk' })).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
    expect((await legRow(lineHaul.id)).status).toBe('IN_PROGRESS');

    // (a) An ops account with logistics.operate and NO driver profile at all
    // still completes it with the correct code — the terminal exception is
    // real and unaffected by the courier-identity check.
    const receivingDesk = await makeOperator(['logistics.operate']);
    const pin = await pinOf(lineHaul.id);
    const ok = await post(receivingDesk.cookies, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin, receivedByName: 'Receiving desk' });
    expect(ok.status).toBe(201);
    expect((await legRow(lineHaul.id)).status).toBe('COMPLETED');
  });

  it("6b · terminal-to-terminal handoff still refuses an actor without logistics.operate, code or not", async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls } = await journey(shipment.id);
    const lineHaul = lineHauls[0]!;

    await driveToInProgress(courier, firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: await pinOf(firstMile.id), receivedByName: 'Terminal desk' })).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);

    const pin = await pinOf(lineHaul.id);
    const r = await post(sender.cookies, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin, receivedByName: 'Nobody' });
    expect(r.status).toBe(403);
    expect((await legRow(lineHaul.id)).status).toBe('IN_PROGRESS');
  });

  it('7 · a legitimate reassignment: the newly assigned courier succeeds with no special case', async () => {
    const sender = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    await dispatch.dispatchLeg(firstMile.id);
    const assigned = await legRow(firstMile.id);
    expect(assigned.assignedDriverProfileId).toBe(courierA.driverProfileId);

    const vehicleB = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: courierB.driverProfileId } });
    const reassign = await post(admin, `admin/logistics/legs/${firstMile.id}/reassign`, {
      driverProfileId: courierB.driverProfileId,
      vehicleId: vehicleB.id,
      reason: 'Courier A reported a breakdown.',
    });
    expect(reassign.status).toBe(201);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courierB.driverProfileId);

    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);

    const pin = await pinOf(firstMile.id);
    const r = await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Receiver' });
    expect(r.status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');
  });

  /**
   * The converse of test 7, and the one no existing test proved (BMPL-140
   * fresh audit): the check reads the LIVE assignedDriverProfileId column, so
   * a courier who WAS legitimately assigned and then reassigned away must be
   * refused exactly like any other wrong courier — even holding the real,
   * unexpired PIN. A future refactor that tracked "ever assigned" instead of
   * "currently assigned" would pass every other test in this file, including
   * the new-courier-succeeds case above, while letting the ousted courier
   * back in. Only this test would catch that regression.
   *
   * Two doors are checked, because they are two different pieces of code:
   * (a) courier A's OWN route, which the pre-existing driver-scoping
   * (`ownedLeg`) already refuses on a plain profile-id mismatch — this proves
   * that lock still holds after a reassignment, not just against a stranger.
   * (b) the specific mechanism BMPL-174 added inside `verifyHandoffPin`
   * itself, reached only via the admin route: courier A is ALSO granted
   * `logistics.operate` on their own account (a real, if narrow, shape — the
   * same "ops account who happens to be a driver" pattern as test 2, just
   * using courier A's OWN profile instead of an unrelated one). That is the
   * one path that actually re-exercises the live-column comparison your
   * architecture comment worries about, rather than the earlier ownedLeg gate.
   */
  it('8 · a courier reassigned AWAY is refused with the real code, even though they held it legitimately a moment ago', async () => {
    const sender = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    // REASSIGN is only a valid transition from ASSIGNED/DRIVER_ACCEPTED/
    // DRIVER_DECLINED (packages/shared/src/dispatch.ts) — i.e. strictly
    // BEFORE physical pickup. Courier A accepts and goes no further.
    await dispatch.dispatchLeg(firstMile.id);
    const assigned = await legRow(firstMile.id);
    expect(assigned.assignedDriverProfileId).toBe(courierA.driverProfileId);
    expect((await post(courierA.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);

    const vehicleB = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: courierB.driverProfileId } });
    expect((await post(admin, `admin/logistics/legs/${firstMile.id}/reassign`, {
      driverProfileId: courierB.driverProfileId,
      vehicleId: vehicleB.id,
      reason: 'Courier A reported a breakdown.',
    })).status).toBe(201);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courierB.driverProfileId);

    // Courier B carries it all the way to IN_PROGRESS, so the leg has genuinely
    // started (verifyHandoffPin's own status gate opens) by the time A tries.
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const pin = await pinOf(firstMile.id);

    // (a) Courier A's own route: the pre-existing driver-scoping refuses —
    // A was never picked up, so ownedLeg refuses on profile mismatch alone,
    // BEFORE ever reaching verifyHandoffPin. The counter must NOT move here —
    // this is a different gate, not a wrong-courier attempt against the PIN.
    const ownRoute = await post(courierA.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Courier A' });
    expect([400, 403, 404]).toContain(ownRoute.status);
    expect((await legRow(firstMile.id)).handoffPinAttempts).toBe(0);

    // (b) Courier A, now ALSO holding logistics.operate, tries the admin
    // route with their own (still-real, still-current) driver profile — the
    // exact shape verifyHandoffPin's own check exists to refuse.
    await ctx.prisma.userRole.upsert({
      where: { userId_roleCode: { userId: courierA.userId, roleCode: 'ADMIN' } },
      create: { userId: courierA.userId, roleCode: 'ADMIN', status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED', approvedAt: new Date() },
    });
    await ctx.prisma.adminPermissionGrant.create({ data: { userId: courierA.userId, permission: 'logistics.operate' } });
    const opsRoute = await post(courierA.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, { pin, receivedByName: 'Courier A' });
    expect(opsRoute.status).toBe(400);

    const after = await legRow(firstMile.id);
    expect(after.status).not.toBe('COMPLETED');
    expect(after.assignedDriverProfileId).toBe(courierB.driverProfileId);
    // The shared attempt counter moved by exactly one — the SAME accounting
    // as test 2's unrelated impostor, so an ousted courier cannot probe the
    // real code for free from a de-assigned account. And the audit record
    // classifies it identically: wrongCourier: true, the one flag that tells
    // this failure apart from a simple wrong code, same as any other impostor.
    expect(after.handoffPinAttempts).toBe(1);
    const failure = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED', actorId: courierA.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(failure).not.toBeNull();
    expect((failure!.newValue as { wrongCourier: boolean }).wrongCourier).toBe(true);

    // And B, the courier the leg actually belongs to now, still succeeds —
    // the ousted attempts above changed nothing about B's own path.
    const r = await post(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Receiver' });
    expect(r.status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');
  });
});
