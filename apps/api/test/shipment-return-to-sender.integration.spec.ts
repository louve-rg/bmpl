/**
 * Return-to-sender for a non-vendor courier shipment (BMPL-183/343), against
 * real Postgres.
 *
 * THE NAMED RULE (owner ruling): a return after custody is a NEW transport
 * service, priced with BML's normal configured pricing for that return
 * movement — calculated, shown, explicitly confirmed, then charged through
 * the existing payment flow. Never a silent reversal of the original charge,
 * never an invented number, never a direct wallet mutation. IF NO VALID
 * CONFIGURED PRICE CAN BE CALCULATED, THE RETURN STAYS PENDING OR MANUAL
 * RATHER THAN GUESSING — a supported, tested outcome, not an error.
 *
 * Scope fence: non-vendor courier shipments only. A marketplace shipment
 * (one fulfilling a VendorOrder) must never be reachable through this path —
 * proven here, not assumed.
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

/** An approved, online driver with a vehicle, serving both fixture districts. */
async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`rdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Rrv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `RDL-${s}`,
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
      licencePlate: `RZ-${s}`.slice(0, 18),
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
    { code: 'RMUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'RSPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'RPLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'RPLA', to: 'RMUN', minutes: 45, price: 8000 },
    { from: 'RMUN', to: 'RSPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

/** Only added inside the tests that need a priceable reverse route. */
async function addReverseRoutes() {
  for (const r of [
    { from: 'RSPA', to: 'RMUN', minutes: 20, price: 6000 },
    { from: 'RMUN', to: 'RPLA', minutes: 45, price: 8000 },
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

/** A driver walks a courier leg through every transition to the handoff. */
async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/**
 * Walks a full DOOR_TO_DOOR journey (Placencia -> Belize City hub -> San
 * Pedro) all the way to a failed final-mile attempt: first mile driven and
 * handed off, the line-haul departed, arrived and handed off at the
 * destination hub, a second driver assigned the LAST_MILE leg who has
 * already collected the parcel (out for delivery) — then the recipient
 * cannot be reached, exactly as a real driver-app failure would report it.
 */
async function walkToLastMileException(reason?: string) {
  const firstDriver = await makeDriver();
  const lastDriver = await makeDriver();
  const shipment = await book();

  const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, firstDriver)).status).toBe(201);
  await driveCourierLeg(firstDriver, first.id);

  // Two hops (Placencia -> Belize City hub -> San Pedro hub), so TWO
  // LINE_HAUL legs — both have to be walked to completion, in sequence,
  // before the LAST_MILE leg is actionable.
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

const previewReturn = (legId: string) => post(admin, `admin/logistics/legs/${legId}/return-quote`, {});
const returnToSender = (legId: string, body: object = { note: 'Recipient unreachable after two attempts.' }) =>
  post(admin, `admin/logistics/legs/${legId}/return-to-sender`, body);

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
      reference: `MKT-${s}`,
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
  const c = await registerUser(`rcust_${uniq()}@example.com`);
  customer = c.cookies;
  customerUserId = c.userId;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Return-to-sender fixture.' });
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('previewReturn — read-only, moves nothing', () => {
  it('shows the reverse route\'s real price without creating or charging anything', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();

    const shipmentsBefore = await ctx.prisma.shipment.count();
    const before = (await get(customer, 'wallet')).body as { availableMinor: number };

    const r = await previewReturn(legId);
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(true);
    expect(r.body.totalMinor).toBeGreaterThan(0);

    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor);
  });

  it('reports the same unavailability an ordinary quote would when the reverse lane has no configured route', async () => {
    const { legId } = await walkToLastMileException();
    // No addReverseRoutes(): SPA->MUN / MUN->PLA were never created, only the
    // forward PLA->MUN / MUN->SPA pair — routes are directional (see
    // route-planner.ts's adjacency, keyed on originHubId only).
    const r = await previewReturn(legId);
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(false);
  });

  it('refuses when the leg is not in exception', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    const r = await previewReturn(first.id);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not in exception/i);
  });

  it('reports unavailable — NOT a computed price — for a mid-carry FIRST_MILE/LINE_HAUL exception, since the shipment-level reversal would price the wrong movement', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await flag(first.id, 'Vehicle broke down at the pickup.')).status).toBe(201);

    const r = await previewReturn(first.id);
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(false);
    expect(r.body.message).toMatch(/human decision/i);
    // No totalMinor at all — never computed, not merely hidden.
    expect(r.body.totalMinor).toBeUndefined();
  });

  it('REFUSES on a marketplace shipment — proving the return path cannot be reached from there', async () => {
    const { legId } = await marketplaceExceptionLeg();
    const r = await previewReturn(legId);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/marketplace/i);
  });
});

describe('returnToSender — the confirmation, and the only step that may charge', () => {
  it('books a new return shipment at the normal configured reverse price, charges the sender through the ordinary payment flow, and links it back — the original leg is left exactly as it was', async () => {
    const { shipment, legId } = await walkToLastMileException();
    await addReverseRoutes();

    const before = (await get(customer, 'wallet')).body as { availableMinor: number };
    const preview = await previewReturn(legId);
    expect(preview.body.available).toBe(true);
    const expectedPrice = preview.body.totalMinor as number;

    const r = await returnToSender(legId);
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('INITIATED');
    expect(r.body.returnShipment).toBeTruthy();
    expect(r.body.returnShipment.id).not.toBe(shipment.id);

    const returnRow = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.returnShipment.id } });
    expect(returnRow.returnOfShipmentId).toBe(shipment.id);
    expect(returnRow.customerUserId).toBe(customerUserId);
    expect(Number(returnRow.quotedTotalMinor)).toBe(expectedPrice);
    // Swapped: the return starts where the parcel actually was (the original
    // destination) and ends back at the original sender.
    expect(returnRow.originCity).toBe('San Pedro');
    expect(returnRow.destinationCity).toBe('Placencia');

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: returnRow.id } });
    expect(payment.status).toBe('AUTHORIZED');
    expect(Number(payment.amountMinor)).toBe(expectedPrice);

    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor - expectedPrice);

    // The ORIGINAL LEG is left exactly as it was — EXCEPTION, never
    // CANCELLED, the historical record of what actually happened to it.
    // The ORIGINAL SHIPMENT's own derived status, though, now reads RETURNED
    // (BMPL-356): once a return is booked and charged, staying at EXCEPTION
    // forever would be honest-but-stale — the attention this needed has
    // been given, and the return itself is the record of what came of it.
    const originalLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(originalLeg.status).toBe('EXCEPTION');
    const originalShipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(originalShipment.status).toBe('RETURNED');

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_RETURN_INITIATED' } });
    const mine = audits.find((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id);
    expect(mine).toBeTruthy();
    expect((mine!.newValue as { returnShipmentId?: string }).returnShipmentId).toBe(returnRow.id);
    expect((mine!.newValue as { priceMinor?: number }).priceMinor).toBe(expectedPrice);

    // BMPL-367: the signal is exposed on the wire, not just in the database —
    // a resolution panel reading the original shipment needs to know WHICH
    // new shipment it became, not just that its status changed.
    const fetched = await request(ctx.server).get(`/api/admin/logistics/shipments/${shipment.reference}`).set('Cookie', admin);
    expect(fetched.status).toBe(200);
    expect(fetched.body.status).toBe('RETURNED');
    expect(fetched.body.returnShipment).toMatchObject({ id: returnRow.id, reference: returnRow.reference });
    expect(fetched.body.rerouteShipment).toBeNull();
  });

  it('STAYS PENDING_MANUAL — charges nobody and creates nothing — when the reverse route has no configured price, rather than guessing one', async () => {
    const { shipment, legId } = await walkToLastMileException();
    // No addReverseRoutes(): the reverse lane is genuinely unconfigured.
    const shipmentsBefore = await ctx.prisma.shipment.count();
    const before = (await get(customer, 'wallet')).body as { availableMinor: number };

    const r = await returnToSender(legId);
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('PENDING_MANUAL');
    expect(r.body.returnShipment).toBeUndefined();

    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('EXCEPTION');

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_RETURN_PENDING_MANUAL' } });
    expect(audits.some((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id)).toBe(true);
  });

  it('STAYS PENDING_MANUAL — audited, charges nobody, creates nothing — for a mid-carry FIRST_MILE/LINE_HAUL exception too (god\'s review: a flat refusal here would leave ops no trail for a parcel genuinely stuck mid-journey)', async () => {
    const driver = await makeDriver();
    const shipment = await book();
    const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await flag(first.id, 'Vehicle broke down at the pickup.')).status).toBe(201);

    const shipmentsBefore = await ctx.prisma.shipment.count();
    const before = (await get(customer, 'wallet')).body as { availableMinor: number };

    const r = await returnToSender(first.id);
    expect(r.status).toBe(201);
    expect(r.body.outcome).toBe('PENDING_MANUAL');
    expect(r.body.reason).toMatch(/human decision/i);
    expect(r.body.returnShipment).toBeUndefined();

    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const after = (await get(customer, 'wallet')).body as { availableMinor: number };
    expect(after.availableMinor).toBe(before.availableMinor);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(leg.status).toBe('EXCEPTION');

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_RETURN_PENDING_MANUAL' } });
    const mine = audits.find((a) => (a.newValue as { shipmentId?: string }).shipmentId === shipment.id);
    expect(mine).toBeTruthy();
    expect((mine!.newValue as { planReason?: string }).planReason).toBe('MID_CARRY');
  });

  it('REFUSES a second return once one is already booked for the same shipment', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();
    expect((await returnToSender(legId)).status).toBe(201);

    const again = await returnToSender(legId);
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already returned/i);
  });

  it('REFUSES to resolve/resume the original leg once a return has already been booked against it (BMPL-356: the original attempt is settled, not reopened)', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();
    expect((await returnToSender(legId)).status).toBe(201);

    const r = await post(admin, `admin/logistics/legs/${legId}/resolve-exception`, { resolution: 'RESUME', note: 'Trying to resume anyway.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already returned/i);

    // Still RETURNED, not nudged back toward IN_PROGRESS/READY by the refused call.
    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } })).shipmentId } });
    expect(shipment.status).toBe('RETURNED');
  });

  it('REFUSES on a marketplace shipment, and creates or charges nothing', async () => {
    const { shipment, legId } = await marketplaceExceptionLeg();
    const shipmentsBefore = await ctx.prisma.shipment.count();

    const r = await returnToSender(legId);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/marketplace/i);
    expect(await ctx.prisma.shipment.count()).toBe(shipmentsBefore);
    const untouched = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(untouched.returnOfShipmentId).toBeNull();
  });

  it('needs logistics.manage — logistics.operate (enough to flag or resolve the very same exception) is refused', async () => {
    const { legId } = await walkToLastMileException();
    await addReverseRoutes();

    const operator = await seedLimitedAdmin(ctx.prisma, `roperator_${uniq()}@example.com`, ['logistics.operate']);
    const operatorCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: operator.email, password: operator.password }),
    );
    const asOperator = await post(operatorCookies, `admin/logistics/legs/${legId}/return-to-sender`, { note: 'Trying with the wrong permission.' });
    expect(asOperator.status).toBe(403);

    // The read-only preview stays at the operate tier — it creates no charge.
    const previewAsOperator = await post(operatorCookies, `admin/logistics/legs/${legId}/return-quote`, {});
    expect(previewAsOperator.status).toBe(201);

    const manager = await seedLimitedAdmin(ctx.prisma, `rmanager_${uniq()}@example.com`, ['logistics.manage']);
    const managerCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: manager.email, password: manager.password }),
    );
    const asManager = await post(managerCookies, `admin/logistics/legs/${legId}/return-to-sender`, { note: 'Manager confirming the return.' });
    expect(asManager.status).toBe(201);
  });
});
