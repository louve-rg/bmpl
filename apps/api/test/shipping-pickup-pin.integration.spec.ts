/**
 * SHIPPING-E2E step 9 — RULING 1 (owner): a leg that genuinely enforces a
 * pickup code (FIRST_MILE/DIRECT, service needsFirstMile) must FAIL on a
 * missing, empty or malformed pin — never silently pass through to
 * PICKUP_CONFIRMED. A leg that never enforced one must keep working exactly
 * as before, pin or no pin, so a permissive default on one leg kind never
 * becomes a permissive default everywhere.
 *
 * RULING 3: the shared DELIVERY_PIN_MAX_ATTEMPTS threshold is security-
 * relevant — pinned here so a future silent change has to argue with a test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';
import { DELIVERY_PIN_MAX_ATTEMPTS } from '@bmpl/shared';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

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

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Pickup-pin test fixture.' });
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
async function pickupPinOf(legId: string) {
  return (await legRow(legId)).pickupPin!;
}
async function assignedAndAccepted(courier: { cookies: string[] }, legId: string) {
  await dispatch.dispatchLeg(legId);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
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

describe('a leg that enforces a pickup code fails closed; one that does not keeps working (SHIPPING-E2E, RULING 1)', () => {
  it('RULING 3 — the shared lockout threshold is pinned at 5, not re-derived from a live read', () => {
    expect(DELIVERY_PIN_MAX_ATTEMPTS).toBe(5);
  });

  it('1 · a FIRST_MILE leg on a DOOR_TO_DOOR shipment enforces the code: no pin at all is a rejection, not a silent pass (a POST-FEATURE leg, not grandfathered)', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    // This leg was created by ShipmentService.legData() in this same test run,
    // so it is never exempt from ruling 1 — the contrasting case to test 8.
    expect(firstMile.pickupPinGrandfathered).toBe(false);
    await assignedAndAccepted(courier, firstMile.id);

    const noBody = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`);
    expect(noBody.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.courierStatus).toBe('DRIVER_ACCEPTED'); // never advanced
    expect(after.pickedUpAt).toBeNull();
  });

  it('2 · the same enforcing leg: an empty pin is a rejection, caught by validation before the service is ever reached', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);

    const empty = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: '' });
    expect(empty.status).toBe(400);
    expect((await legRow(firstMile.id)).pickedUpAt).toBeNull();
  });

  it('3 · the same enforcing leg: a malformed pin (letters, wrong length) is a rejection', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);

    const malformed = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: 'abcd' });
    expect(malformed.status).toBe(400);
    expect((await legRow(firstMile.id)).pickedUpAt).toBeNull();
  });

  it('4 · the same enforcing leg: the WRONG (but well-formed) code is rejected and counted', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);

    const real = await pickupPinOf(firstMile.id);
    const wrong = real === '0000' ? '1111' : '0000';
    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: wrong });
    expect(r.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.pickupPinAttempts).toBe(1);
    expect(after.pickedUpAt).toBeNull();
  });

  it('5 · the same enforcing leg: the RIGHT code succeeds, advances the leg, and marks pickupVerificationStatus VERIFIED', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);

    const pin = await pickupPinOf(firstMile.id);
    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin });
    expect(r.status).toBe(201);
    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.pickedUpAt).not.toBeNull();
    expect(after.pickupVerificationStatus).toBe('VERIFIED');
    expect(after.pickupVerifiedAt).not.toBeNull();
  });

  it('5b · RULING 2: a verified pickup code becomes invisible to the sender, and a replay of it is rejected', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);
    const pin = await pickupPinOf(firstMile.id);

    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin })).status).toBe(201);

    // The sender's own view must stop exposing a code that has already been
    // used — unlike a completed handoff, this leg stays IN_PROGRESS for the
    // rest of the journey, so a leg-status-only gate would leave it visible
    // for the entire remaining transit.
    const view = await request(ctx.server).get(`/api/shipping/${shipment.reference}`).set('Cookie', sender.cookies);
    expect(view.status).toBe(200);
    const legView = view.body.legs.find((l: { id: string }) => l.id === firstMile.id);
    expect(legView.pickupPin).toBeNull();

    // Replaying the same code: the leg already moved past DRIVER_ACCEPTED,
    // so the action guard rejects it before the pin is ever re-checked.
    const replay = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin });
    expect(replay.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.pickupVerificationStatus).toBe('VERIFIED');
    expect(after.status).toBe('IN_PROGRESS');
  });

  it('6 · lockout: 5 wrong attempts lock the leg into EXCEPTION, same as handoff — and staff RESUME clears exactly this counter', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await assignedAndAccepted(courier, firstMile.id);

    const real = await pickupPinOf(firstMile.id);
    const wrong = real === '0000' ? '1111' : '0000';
    for (let i = 0; i < DELIVERY_PIN_MAX_ATTEMPTS; i += 1) {
      const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: wrong });
      expect(r.status).toBe(400);
    }
    const locked = await legRow(firstMile.id);
    expect(locked.status).toBe('EXCEPTION');
    expect(locked.pickupPinAttempts).toBe(DELIVERY_PIN_MAX_ATTEMPTS);

    // Even the RIGHT code is refused now — locked means locked, not "one more
    // try": the leg is EXCEPTION, and assertNotException refuses any further
    // pickup call on that status (409) before the pin is ever re-checked,
    // same as every other driver action on an excepted leg.
    const stillLocked = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: real });
    expect(stillLocked.status).toBe(409);

    // The staff escape hatch: RESUME clears the counter, same mechanism MDF-2 built for handoff.
    const resumed = await post(admin, `admin/logistics/legs/${firstMile.id}/resolve-exception`, {
      resolution: 'RESUME',
      note: 'Pickup PIN lockout cleared after confirming with the courier.',
    });
    expect(resumed.status).toBe(201);
    const after = await legRow(firstMile.id);
    expect(after.status).not.toBe('EXCEPTION');
    expect(after.pickupPinAttempts).toBe(0);

    // The real code works again after the reset.
    const ok = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: real });
    expect(ok.status).toBe(201);
  });

  it('7 · a LAST_MILE leg never enforced a pickup code, and still does not: no pin, wrong-shaped pin, anything — all harmlessly ignored', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { firstMile, lineHauls, lastMile } = await journey(shipment.id);

    // Walk the parcel to the point the LAST_MILE leg is actually workable.
    await assignedAndAccepted(firstCourier, firstMile.id);
    const firstPin = await pickupPinOf(firstMile.id);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: firstPin })).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const handoffPin = (await legRow(firstMile.id)).handoffPin!;
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: handoffPin, receivedByName: 'Terminal desk' })).status).toBe(201);
    for (const lh of lineHauls) {
      expect((await post(admin, `admin/logistics/legs/${lh.id}/depart`, {})).status).toBe(201);
      expect((await post(admin, `admin/logistics/legs/${lh.id}/arrive`, {})).status).toBe(201);
      const lhPin = (await legRow(lh.id)).handoffPin!;
      expect((await post(admin, `admin/logistics/legs/${lh.id}/handoff`, { pin: lhPin, receivedByName: 'Counter staff' })).status).toBe(201);
    }

    await dispatch.dispatchLeg(lastMile.id);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);

    // No body at all — a LAST_MILE leg's own pickup (collecting from the
    // terminal, not a sender's door) never enforced one and still does not.
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/pickup`)).status).toBe(201);
    expect((await legRow(lastMile.id)).status).toBe('IN_PROGRESS');
  });

  it('8 · MIGRATION DAY (owner ruling): a leg that predates the pickup-pin feature collects with no code at all, and the exemption is recorded on the audit row', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);

    // Simulate exactly what the migration's own default-flip produces for a
    // row that already existed: pickupPin stays NULL forever (nothing ever
    // backfills it) and pickupPinGrandfathered is true. This leg is
    // structurally identical to test 1's (FIRST_MILE, DOOR_TO_DOOR) — the
    // grandfather flag is the ONLY difference, proving it is what decides
    // the outcome, not an incidental consequence of the pin being null.
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMile.id }, data: { pickupPinGrandfathered: true } });

    await assignedAndAccepted(courier, firstMile.id);
    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`);
    expect(r.status).toBe(201);
    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.pickedUpAt).not.toBeNull();
    // Grandfathering means never-enforced — it must NOT backdate to VERIFIED,
    // which would misrepresent a code that was never checked as one that was.
    expect(after.pickupVerificationStatus).toBe('PENDING');

    const audit = (await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_LEG_PICKED_UP' } })).find(
      (a) => (a.newValue as { legId?: string }).legId === firstMile.id,
    );
    expect((audit!.newValue as { pickupPinGrandfathered?: boolean }).pickupPinGrandfathered).toBe(true);
  });
});
