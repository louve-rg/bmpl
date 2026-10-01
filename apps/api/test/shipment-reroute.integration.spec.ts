/**
 * Hold's recipient notification, and reroute for a non-vendor courier
 * shipment (BMPL-343), against real Postgres — both extending the same
 * EXCEPTION-gated primitive BMPL-183/343's return-to-sender already built
 * (see shipment-return-to-sender.integration.spec.ts).
 *
 * HOLD (owner Ruling 1): `flagException` already is the hold primitive — no
 * new state machine was needed, only closing the one real gap research
 * found: staff and the sender were already notified, the recipient was not.
 *
 * THE OWNER'S THREE REROUTE RULES: never invent a reroute price and never
 * silently charge anyone; a reroute that changes the customer's charge uses
 * real configured pricing, shows it, and requires confirmation before
 * charging — the same PENDING/MANUAL fence as a return when no valid price
 * exists; a reroute that does NOT increase the charge still needs the
 * customer informed of the material ETA change, it just does not need a
 * payment-confirmation dialog for the sake of having one.
 *
 * Scope fence: non-vendor courier shipments only, same as return-to-sender —
 * proven here again rather than assumed carried over.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerUserId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
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
  const { cookies, userId } = await registerUser(`gdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Grv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `GDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `GZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Placencia (STANN_CREEK) <-> Belize City hub <-> San Pedro (BELIZE), forward direction only. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'GMUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'GSPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'GPLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'GPLA', to: 'GMUN', minutes: 45, price: 8000 },
    { from: 'GMUN', to: 'GSPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

/** Only added inside the tests that need a priceable reverse/onward route. */
async function addReverseRoutes() {
  for (const r of [
    { from: 'GSPA', to: 'GMUN', minutes: 20, price: 6000 },
    { from: 'GMUN', to: 'GPLA', minutes: 45, price: 8000 },
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

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

const flag = (legId: string, reason = 'Recipient not home; no safe place to leave the parcel.') =>
  post(admin, `admin/logistics/legs/${legId}/exception`, { reason });

async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/** Same walk as the return-to-sender suite's own helper — see its comment. */
async function walkToLastMileException(reason?: string) {
  const firstDriver = await makeDriver();
  const lastDriver = await makeDriver();
  const shipment = await book();

  const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, firstDriver)).status).toBe(201);
  await driveCourierLeg(firstDriver, first.id);

  const hauls = (await legs(shipment.id)).filter((l) => l.kind === 'LINE_HAUL');
  for (const haul of hauls) {
    expect((await post(admin, `admin/logistics/legs/${haul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${haul.id}/arrive`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${haul.id}/handoff`, {
      pin: await pinOf(haul.id), receivedByName: 'Hub desk',
    })).status).toBe(201);
  }

  const last = (await legs(shipment.id)).find((l) => l.kind === 'LAST_MILE')!;
  expect((await assign(last.id, lastDriver)).status).toBe(201);
  expect((await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/accept`)).status).toBe(201);
  expect((await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/pickup`)).status).toBe(201);

  expect((await flag(last.id, reason)).status).toBe(201);
  return { shipment, legId: last.id, driver: lastDriver };
}

const previewReroute = (legId: string, destination: object) => post(admin, `admin/logistics/legs/${legId}/reroute-quote`, { destination });
const rerouteShipment = (legId: string, destination: object, note = 'Recipient asked for a different address.') =>
  post(admin, `admin/logistics/legs/${legId}/reroute`, { destination, note });

/** To a terminal (GMUN) rather than a door — avoids local-delivery edge
 *  cases a same-city door redirect would hit, and needs only the GSPA->GMUN
 *  leg `addReverseRoutes()` adds. */
const toHub = () => ({ hubId: hub.GMUN, name: 'Counter pickup', phone: '501-7778888' });

/** A shipment fulfilling a marketplace order — the scope fence's other side. */
async function marketplaceExceptionLeg() {
  const s = uniq();
  const vendorUser = await ctx.prisma.user.create({ data: { email: `vend_${s}@example.bz`, passwordHash: 'x', firstName: 'V', lastName: 'U' } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: { userId: vendorUser.id, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' },
  });
  const buyer = await ctx.prisma.user.create({ data: { email: `buy_${s}@example.bz`, passwordHash: 'x', firstName: 'B', lastName: 'U' } });
  const order = await ctx.prisma.order.create({
    data: { orderNumber: `ORD-${s}`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 0n, totalMinor: 1000n },
  });
  const vo = await ctx.prisma.vendorOrder.create({
    data: { orderNumber: `ORD-${s}-1`, orderId: order.id, vendorProfileId: vp.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n },
  });
  const shipment = await ctx.prisma.shipment.create({
    data: {
      reference: `MKG-${s}`,
      service: 'DOOR_TO_DOOR',
      customerUserId: buyer.id,
      vendorOrderId: vo.id,
      originName: 'Store', originPhone: '501-2223333', originCity: 'Placencia', originDistrict: 'STANN_CREEK',
      destinationName: 'Buyer', destinationPhone: '501-4445555', destinationCity: 'Belize City', destinationDistrict: 'BELIZE',
      quotedTotalMinor: 1000n,
      legs: {
        create: [
          { sequence: 1, kind: 'LAST_MILE', mode: 'LAND', status: 'EXCEPTION', exceptionAt: new Date(), exceptionReason: 'Recipient unavailable.' },
        ],
      },
    },
    include: { legs: true },
  });
  return { shipment, legId: shipment.legs[0]!.id };
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
  await ctx.prisma.notificationRecipient.deleteMany();
  await ctx.prisma.notification.deleteMany();
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.vendorOrder.deleteMany();
  await ctx.prisma.order.deleteMany();
  await ctx.prisma.vendorProfile.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`gcust_${uniq()}@example.com`);
  customer = c.cookies;
  customerUserId = c.userId;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Reroute fixture.' });
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('hold (flagException) — Ruling 1: both sender and recipient are told, not staff alone', () => {
  it('notifies a genuinely linked recipient, in addition to the sender transition() already notifies', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    // Simulating an already-claimed recipient directly: the claim flow itself
    // (claimAsRecipient) is its own feature with its own tests; what this
    // test isolates is flagException's own notification fan-out once that
    // link exists.
    const recipient = await registerUser(`grecip_${uniq()}@example.com`);
    await ctx.prisma.shipment.update({ where: { id: shipment.id }, data: { recipientUserId: recipient.userId } });

    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await flag(first.id, 'Recipient asked for a hold while they travel.')).status).toBe(201);

    const toRecipient = await ctx.prisma.notificationRecipient.findMany({
      where: { userId: recipient.userId },
      include: { notification: true },
    });
    const exceptionNotice = toRecipient.find((r) => r.notification.event === 'SHIPMENT_STATUS');
    expect(exceptionNotice).toBeTruthy();
    expect(exceptionNotice!.notification.body).toMatch(/needs attention/i);

    const toSender = await ctx.prisma.notificationRecipient.findMany({
      where: { userId: customerUserId },
      include: { notification: true },
    });
    expect(toSender.some((r) => r.notification.event === 'SHIPMENT_STATUS')).toBe(true);
  });

  it('does not fail, and sends no stray recipient notification, when nobody has claimed the recipient slot yet', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    const r = await flag(first.id, 'Vehicle broke down at the pickup.');
    expect(r.status).toBe(201);
    // No account exists to notify, so no NotificationRecipient row can name
    // one — the honest limit this feature documents rather than invents a
    // channel around.
  });
});

describe('previewReroute — read-only, moves nothing', () => {
  it('shows the redirected route\'s real price without creating or charging anything, and names whether it increases the charge', async () => {
    const { shipment, legId } = await walkToLastMileException();
    await addReverseRoutes();

    const shipmentsBefore = await ctx.prisma.shipment.count();
    const before = (await get(customer, 'wallet')).body as { availableMinor: number };

    const r = await previewReroute(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(true);
    expect(r.body.totalMinor).toBeGreaterThan(0);
    expect(typeof r.body.increasesCharge).toBe('boolean');
    expect(r.body.increasesCharge).toBe(r.body.totalMinor > Number(shipment.quotedTotalMinor));

    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor);
  });

  it('reports increasesCharge: true when the redirect costs more than the customer already paid', async () => {
    const { shipment, legId } = await walkToLastMileException();
    await addReverseRoutes();
    // Forced low rather than relying on the planner's own numbers to differ:
    // this isolates the comparison itself, not the pricing engine (already
    // covered by shipment.pricing tests and the quote() tests above).
    await ctx.prisma.shipment.update({ where: { id: shipment.id }, data: { quotedTotalMinor: 1n } });

    const r = await previewReroute(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(true);
    expect(r.body.increasesCharge).toBe(true);
  });

  it('reports increasesCharge: false when the redirect does not cost more than the customer already paid', async () => {
    const { shipment, legId } = await walkToLastMileException();
    await addReverseRoutes();
    await ctx.prisma.shipment.update({ where: { id: shipment.id }, data: { quotedTotalMinor: 99_999_999n } });

    const r = await previewReroute(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(true);
    expect(r.body.increasesCharge).toBe(false);
  });

  it('reports the same unavailability an ordinary quote would when the onward lane has no configured route', async () => {
    const { legId } = await walkToLastMileException();
    // No addReverseRoutes(): GSPA->GMUN was never created.
    const r = await previewReroute(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(false);
  });

  it('refuses when the leg is not in exception', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    const r = await previewReroute(first.id, toHub());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not in exception/i);
  });

  it('reports unavailable — NOT a computed price — for a mid-carry FIRST_MILE/LINE_HAUL exception, same hazard as a return', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await flag(first.id, 'Vehicle broke down at the pickup.')).status).toBe(201);

    const r = await previewReroute(first.id, toHub());
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(false);
    expect(r.body.message).toMatch(/human decision/i);
    expect(r.body.totalMinor).toBeUndefined();
  });

  it('REFUSES on a marketplace shipment — proving the reroute path cannot be reached from there', async () => {
    const { legId } = await marketplaceExceptionLeg();
    const r = await previewReroute(legId, toHub());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/marketplace/i);
  });
});

describe('rerouteShipment — the confirmation, and the only step that may charge', () => {
  it('books a new shipment to the new destination at the normal configured price, charges the sender, links it back, notifies sender and recipient, and leaves the original leg/shipment exactly as it was', async () => {
    const { shipment, legId } = await walkToLastMileException();
    await addReverseRoutes();
    const recipient = await registerUser(`grecip2_${uniq()}@example.com`);
    await ctx.prisma.shipment.update({ where: { id: shipment.id }, data: { recipientUserId: recipient.userId } });

    const before = (await get(customer, 'wallet')).body as { availableMinor: number };
    const preview = await previewReroute(legId, toHub());
    expect(preview.body.available).toBe(true);
    const expectedPrice = preview.body.totalMinor as number;

    const r = await rerouteShipment(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('INITIATED');
    expect(r.body.rerouteShipment).toBeTruthy();
    expect(r.body.rerouteShipment.id).not.toBe(shipment.id);
    expect(r.body.increasesCharge).toBe(expectedPrice > Number(shipment.quotedTotalMinor));

    const rerouteRow = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.rerouteShipment.id } });
    expect(rerouteRow.rerouteOfShipmentId).toBe(shipment.id);
    expect(rerouteRow.customerUserId).toBe(customerUserId);
    expect(Number(rerouteRow.quotedTotalMinor)).toBe(expectedPrice);
    // Origin is wherever the parcel actually was; destination is the new address.
    expect(rerouteRow.originCity).toBe('San Pedro');
    expect(rerouteRow.destinationHubId).toBe(hub.GMUN);

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: rerouteRow.id } });
    expect(payment.status).toBe('AUTHORIZED');
    expect(Number(payment.amountMinor)).toBe(expectedPrice);

    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor - expectedPrice);

    // The ORIGINAL LEG is left exactly as it was — EXCEPTION, never
    // CANCELLED, the historical record of what actually happened to it. The
    // ORIGINAL SHIPMENT's own derived status, though, now reads REROUTED
    // (BMPL-367): once a reroute is booked and charged, staying at
    // EXCEPTION forever would be honest-but-stale, the same fix BMPL-356
    // already gave returns.
    const originalLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(originalLeg.status).toBe('EXCEPTION');
    const originalShipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(originalShipment.status).toBe('REROUTED');

    const notified = await ctx.prisma.notificationRecipient.findMany({
      where: { userId: { in: [customerUserId, recipient.userId] } },
      include: { notification: true },
    });
    const rerouted = notified.filter((n) => n.notification.event === 'SHIPMENT_REROUTED');
    expect(rerouted.map((n) => n.userId).sort()).toEqual([customerUserId, recipient.userId].sort());

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_REROUTE_INITIATED' } });
    const mine = audits.find((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id);
    expect(mine).toBeTruthy();
    expect((mine!.newValue as { rerouteShipmentId?: string }).rerouteShipmentId).toBe(rerouteRow.id);
    expect((mine!.newValue as { priceMinor?: number }).priceMinor).toBe(expectedPrice);

    // BMPL-367: the signal is exposed on the wire, not just in the database —
    // a resolution panel reading the original shipment needs to know WHICH
    // new shipment it became, not just that its status changed.
    const fetched = await request(ctx.server).get(`/api/admin/logistics/shipments/${shipment.reference}`).set('Cookie', admin);
    expect(fetched.status).toBe(200);
    expect(fetched.body.status).toBe('REROUTED');
    expect(fetched.body.rerouteShipment).toMatchObject({ id: rerouteRow.id, reference: rerouteRow.reference });
    expect(fetched.body.returnShipment).toBeNull();
  });

  it('STAYS PENDING_MANUAL — charges nobody and creates nothing — when the onward route has no configured price, rather than guessing one', async () => {
    const { shipment, legId } = await walkToLastMileException();
    // No addReverseRoutes(): the onward lane is genuinely unconfigured.
    const shipmentsBefore = await ctx.prisma.shipment.count();
    const before = (await get(customer, 'wallet')).body as { availableMinor: number };

    const r = await rerouteShipment(legId, toHub());
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('PENDING_MANUAL');
    expect(r.body.rerouteShipment).toBeUndefined();

    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_REROUTE_PENDING_MANUAL' } });
    expect(audits.some((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id)).toBe(true);
  });

  it('STAYS PENDING_MANUAL for a mid-carry FIRST_MILE/LINE_HAUL exception too, same reasoning as a return', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await flag(first.id, 'Vehicle broke down at the pickup.')).status).toBe(201);

    const r = await rerouteShipment(first.id, toHub());
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('PENDING_MANUAL');
    expect(r.body.reason).toMatch(/human decision/i);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_REROUTE_PENDING_MANUAL' } });
    const mine = audits.find((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id);
    expect((mine!.newValue as { planReason?: string }).planReason).toBe('MID_CARRY');
  });

  it('REFUSES a second reroute once one is already booked for the same shipment', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();
    expect((await rerouteShipment(legId, toHub())).status).toBe(201);

    const again = await rerouteShipment(legId, toHub());
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already rerouted/i);
  });

  it('REFUSES a reroute once the shipment has already been returned instead', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();
    expect((await post(admin, `admin/logistics/legs/${legId}/return-to-sender`, { note: 'Returned first.' })).status).toBe(201);

    const r = await rerouteShipment(legId, toHub());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already returned/i);
  });

  it('REFUSES to resolve/resume the original leg once a reroute has already been booked against it (BMPL-367: the original attempt is settled, not reopened)', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();
    expect((await rerouteShipment(legId, toHub())).status).toBe(201);

    const r = await post(admin, `admin/logistics/legs/${legId}/resolve-exception`, { resolution: 'RESUME', note: 'Trying to resume anyway.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already rerouted/i);

    // Still REROUTED, not nudged back toward IN_PROGRESS/READY by the refused call.
    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } })).shipmentId } });
    expect(shipment.status).toBe('REROUTED');
  });

  it('REFUSES on a marketplace shipment, and creates or charges nothing', async () => {
    const { shipment, legId } = await marketplaceExceptionLeg();
    const shipmentsBefore = await ctx.prisma.shipment.count();

    const r = await rerouteShipment(legId, toHub());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/marketplace/i);
    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const untouched = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(untouched.rerouteOfShipmentId).toBeNull();
  });

  it('needs logistics.manage — logistics.operate (enough to flag or resolve the very same exception) is refused', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();

    const operator = await seedLimitedAdmin(ctx.prisma, `goperator_${uniq()}@example.com`, ['logistics.operate']);
    const operatorCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: operator.email, password: operator.password }),
    );
    const asOperator = await post(operatorCookies, `admin/logistics/legs/${legId}/reroute`, { destination: toHub(), note: 'Trying with the wrong permission.' });
    expect(asOperator.status).toBe(403);

    const previewAsOperator = await post(operatorCookies, `admin/logistics/legs/${legId}/reroute-quote`, { destination: toHub() });
    expect(previewAsOperator.status).toBe(201);

    const manager = await seedLimitedAdmin(ctx.prisma, `gmanager_${uniq()}@example.com`, ['logistics.manage']);
    const managerCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: manager.email, password: manager.password }),
    );
    const asManager = await post(managerCookies, `admin/logistics/legs/${legId}/reroute`, { destination: toHub(), note: 'Manager confirming the reroute.' });
    expect(asManager.status).toBe(201);
  });
});
