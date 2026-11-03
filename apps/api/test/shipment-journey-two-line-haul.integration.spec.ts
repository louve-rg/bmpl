/**
 * SHIPPING-E2E-JOURNEY: the complete shipment journey over a network with TWO
 * line-haul hops, PLA -> MUN -> SPA — not the single-hop shape every other
 * journey-style spec uses (transport-leg-operations's Edward test,
 * multimodal-simulation). Geography matches shipping-pickup-pin.integration
 * .spec.ts's seedNetwork, reused here rather than invented.
 *
 * Why this file exists rather than extending one of those: `isLegActionable`
 * (packages/shared/src/shipping.ts) refuses a leg until every EARLIER leg by
 * sequence is COMPLETED, and the booking's origin/destination hub derivation
 * (shipment.service.ts) takes the FIRST line-haul's origin and the LAST
 * line-haul's destination. Both are written generically for any number of
 * line-hauls, and neither has ever been exercised at N=2 anywhere in this
 * suite — every existing journey-shaped test uses exactly one hub pair. Code
 * that looks generic but has only ever run at N=1 is untested code that looks
 * tested. This file is the first thing that would catch:
 *   - LAST_MILE becoming assignable once only the FIRST of two line-hauls
 *     completes (isLegActionable reading the wrong "every earlier leg"), or
 *   - the shipment's destinationHubId resolving to MUN (the middle hub)
 *     instead of SPA (the actual final one).
 * Plus one idempotency-key replay on the resulting multi-leg shipment, since
 * the existing idempotency-key coverage never progresses a shipment's legs at
 * all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
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

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Two-line-haul journey fixture.' });
  return { cookies, userId };
}

/** An approved, online driver serving one district. */
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
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `HV-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Three airstrips, two AIR line-hauls: PLA -> MUN -> SPA. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
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

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
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

function bookShipment(cookies: string[], idempotencyKey: string) {
  return request(ctx.server)
    .post('/api/shipping')
    .set('Cookie', cookies)
    .set('Idempotency-Key', idempotencyKey)
    .send({ ...doorToDoor(), payWithWallet: true });
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const legRow = (legId: string) => ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });
const depart = (legId: string, body: object = {}) => post(admin, `admin/logistics/legs/${legId}/depart`, body);
const arrive = (legId: string) => post(admin, `admin/logistics/legs/${legId}/arrive`);
const adminHandoff = (legId: string, pin: string) => post(admin, `admin/logistics/legs/${legId}/handoff`, { pin, receivedByName: 'Counter staff' });

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
  await ctx.prisma.idempotencyKey.deleteMany({ where: { scope: 'shipping' } });
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  await disableDispatch();
  await seedNetwork();
});

describe('the complete journey over two line-haul hops (SHIPPING-E2E-JOURNEY)', () => {
  it('walks FIRST_MILE -> LINE_HAUL#1 -> LINE_HAUL#2 -> LAST_MILE, refusing every leg whose turn has not come, and resolves PLA/SPA not MUN', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');

    const booked = await bookShipment(sender.cookies, 'journey-key-1');
    expect(booked.status).toBe(201);
    const shipment = booked.body as { id: string; reference: string };

    const rows = await legsOf(shipment.id);
    expect(rows.map((l) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LINE_HAUL', 'LAST_MILE']);
    expect(rows.map((l) => l.status)).toEqual(['READY', 'PENDING', 'PENDING', 'PENDING']);
    const [firstMile, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];

    /* --------------------------------------------------------- FIRST_MILE */
    expect((await assign(firstMile.id, firstCourier)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    const pickupPin = (await legRow(firstMile.id)).pickupPin!;
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: pickupPin })).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const firstMileHandoffPin = (await legRow(firstMile.id)).handoffPin!;
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, {
      pin: firstMileHandoffPin, receivedByName: 'Placencia desk',
    })).status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('READY'); // the release this journey depends on

    /* ------------------------------------------- THE N=2 PROOF, PART ONE */
    // LINE_HAUL#2's turn has not come — LINE_HAUL#1 is READY, not COMPLETED.
    // If isLegActionable ever mis-reads "every earlier leg" for a sequence
    // with two LINE_HAULs ahead of it, this is what would start passing.
    const tooSoon1 = await depart(lineHaul2.id, {});
    expect(tooSoon1.status).toBe(400);
    expect(tooSoon1.body.message).toContain('has not reached this leg');
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING'); // refusing moved nothing

    /* -------------------------------------------------------- LINE_HAUL#1 */
    expect((await depart(lineHaul1.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-PLA-MUN' })).status).toBe(201);
    expect((await arrive(lineHaul1.id)).status).toBe(201);
    const lineHaul1Pin = (await legRow(lineHaul1.id)).handoffPin!;
    expect((await adminHandoff(lineHaul1.id, lineHaul1Pin)).status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('COMPLETED');
    expect((await legRow(lineHaul2.id)).status).toBe('READY'); // released, now LINE_HAUL#2's turn

    /* ------------------------------------------- THE N=2 PROOF, PART TWO */
    // The actual claim this file exists to prove: LAST_MILE must wait for
    // BOTH line-hauls, not just the first one to finish.
    const tooSoon2 = await assign(lastMile.id, lastCourier);
    expect(tooSoon2.status).toBe(400);
    expect(tooSoon2.body.message).toContain('has not reached this leg');
    const stillUnassigned = await legRow(lastMile.id);
    expect(stillUnassigned.status).toBe('PENDING');
    expect(stillUnassigned.assignedDriverProfileId).toBeNull();

    /* -------------------------------------------------------- LINE_HAUL#2 */
    expect((await depart(lineHaul2.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-MUN-SPA' })).status).toBe(201);
    expect((await arrive(lineHaul2.id)).status).toBe(201);
    const lineHaul2Pin = (await legRow(lineHaul2.id)).handoffPin!;
    expect((await adminHandoff(lineHaul2.id, lineHaul2Pin)).status).toBe(201);
    expect((await legRow(lineHaul2.id)).status).toBe('COMPLETED');
    expect((await legRow(lastMile.id)).status).toBe('READY'); // only now — both hops done

    /* --------------------------------------------------------- LAST_MILE */
    expect((await assign(lastMile.id, lastCourier)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);
    // LAST_MILE's own pickup (collecting from the terminal) never enforced a
    // code — no body at all, same contract proven elsewhere for this leg kind.
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/pickup`)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/in-transit`)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/arriving`)).status).toBe(201);
    const lastMilePin = (await legRow(lastMile.id)).handoffPin!;
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/handoff`, {
      pin: lastMilePin, receivedByName: 'Recipient',
    })).status).toBe(201);
    expect((await legRow(lastMile.id)).status).toBe('COMPLETED');
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('DELIVERED');

    /* ---------------------------------------- THE HUB-DERIVATION PROOF */
    // The first line-haul's ORIGIN, the last line-haul's DESTINATION — not
    // MUN, the hub both line-hauls pass through in the middle.
    const shipmentRow = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(shipmentRow.originHubId).toBe(hub.PLA);
    expect(shipmentRow.destinationHubId).toBe(hub.SPA);
    expect(shipmentRow.originHubId).not.toBe(hub.MUN);
    expect(shipmentRow.destinationHubId).not.toBe(hub.MUN);

    /* ------------------------------------------------- THE REPLAY PROOF */
    // The existing idempotency-key coverage never progresses a shipment's
    // legs at all — prove a replay against this fully-delivered, multi-leg
    // shipment still returns the SAME shipment and creates nothing new.
    const replay = await bookShipment(sender.cookies, 'journey-key-1');
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(shipment.id);
    expect(await ctx.prisma.shipment.count({ where: { id: shipment.id } })).toBe(1);
    expect(await ctx.prisma.shipmentLeg.count({ where: { shipmentId: shipment.id } })).toBe(4);
    expect(await ctx.prisma.payment.count({ where: { shipmentId: shipment.id } })).toBe(1);
  });
});
