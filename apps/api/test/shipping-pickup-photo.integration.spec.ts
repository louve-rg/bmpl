/**
 * BMPL-178: a package pickup photo on a shipment — private and
 * authorization-scoped.
 *
 * REUSE, NOT INVENTION: `ShipmentLeg.handoffPhotoKeys` already existed as a
 * private-bucket `String[]` (same shape as `OrderDelivery.podPhotoKeys`, the
 * marketplace proof-of-delivery precedent) but nothing in `apps/api` ever
 * wrote or read it. This suite proves the new upload/confirm/read path this
 * card adds: a courier attaches an evidence photo to the SPECIFIC leg they
 * are picking up (server-side upload -> confirm, exactly `uploadPod` /
 * `confirmPod`'s shape), and the stored keys are turned into short-lived
 * signed URLs wherever that leg is already legitimately visible — no new
 * authorization surface, no new exposure. `ownedLeg` is untouched, so this
 * inherits its BMPL-174/187 "necessary but not sufficient" shape: holding a
 * driver profile is necessary, but it must be the profile THIS leg is
 * assigned to.
 *
 * The three legitimate viewers named by the card:
 *  - the sender, via the existing customer `GET shipping/:reference`
 *    (`ShipmentService.track`, ownership-checked);
 *  - the assigned courier, via `GET driver/shipping-jobs/:id`
 *    (`ownedLeg`-checked, unchanged);
 *  - staff/ops, via the same `track()` (`viewer.isStaff` bypasses ownership,
 *    already gated by the guard chain's `logistics.read`/`logistics.operate`
 *    permission on the admin route).
 *
 * The recipient is deliberately NOT covered here: the only recipient-facing
 * surface is `trackPublic` (`GET shipping/track/:token`), and its own doc
 * comment already excludes the parcel description as "customer-typed, can be
 * sensitive" — a photo of the parcel is at least as sensitive by that same
 * reasoning, so extending that anonymous, unauthenticated allowlist to cover
 * it is a product call this suite does not make. Reported, not guessed.
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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const uploadRaw = (c: string[], p: string, buf: Buffer) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).set('Content-Type', 'image/png').send(buf);

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
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Pickup-photo test fixture.' });
  return { cookies, userId };
}

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function firstMileOf(shipmentId: string) {
  return (await legsOf(shipmentId)).find((l) => l.kind === 'FIRST_MILE')!;
}
async function legRow(legId: string) {
  return ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
}

/** Dispatches + accepts a FIRST_MILE leg so its courier can act on it. */
async function assignedFirstMile(shipmentId: string, courier: { cookies: string[] }) {
  const firstMile = await firstMileOf(shipmentId);
  await dispatch.dispatchLeg(firstMile.id);
  expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
  return firstMile;
}

/** Uploads a PNG through the courier's own pickup-photo route; returns its storage key. */
async function uploadPickupPhoto(courier: { cookies: string[] }, legId: string) {
  const r = await uploadRaw(courier.cookies, `driver/shipping-jobs/${legId}/pickup-photo/upload`, PNG);
  expect(r.status).toBe(201);
  return r.body.key as string;
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

describe('shipment pickup photo (BMPL-178)', () => {
  it('1 · a shipment with no photo works exactly as before — every viewer sees an empty array, not an error', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);

    const driverView = await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}`);
    expect(driverView.status).toBe(200);
    expect(driverView.body.pickupPhotoUrls).toEqual([]);

    const senderView = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(senderView.status).toBe(200);
    expect(senderView.body.legs.find((l: { id: string }) => l.id === firstMile.id).pickupPhotoUrls).toEqual([]);

    const staffView = await get(admin, `admin/logistics/shipments/${shipment.reference}`);
    expect(staffView.status).toBe(200);
    expect(staffView.body.legs.find((l: { id: string }) => l.id === firstMile.id).pickupPhotoUrls).toEqual([]);
  });

  it('2 · the assigned courier uploads + attaches a pickup photo, and it shows up for the courier, the sender, and staff', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    const key = await uploadPickupPhoto(courier, firstMile.id);
    expect(key.startsWith(`shipments/pickup-proof/${courier.userId}/`)).toBe(true);

    const confirm = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [key] });
    expect(confirm.status).toBe(201);
    expect(confirm.body.pickupPhotoUrls).toHaveLength(1);
    expect(typeof confirm.body.pickupPhotoUrls[0]).toBe('string');

    expect((await legRow(firstMile.id)).handoffPhotoKeys).toEqual([key]);

    const driverView = await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}`);
    expect(driverView.body.pickupPhotoUrls).toHaveLength(1);

    const senderView = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(senderView.body.legs.find((l: { id: string }) => l.id === firstMile.id).pickupPhotoUrls).toHaveLength(1);

    const staffView = await get(admin, `admin/logistics/shipments/${shipment.reference}`);
    expect(staffView.body.legs.find((l: { id: string }) => l.id === firstMile.id).pickupPhotoUrls).toHaveLength(1);
  });

  it('3 · CROSS-SHIPMENT: a courier and a sender legitimately authorized on shipment A cannot retrieve shipment B\'s photo', async () => {
    const senderA = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const shipmentA = await book(senderA.cookies);
    const legA = await assignedFirstMile(shipmentA.id, courierA);
    const keyA = await uploadPickupPhoto(courierA, legA.id);
    expect((await post(courierA.cookies, `driver/shipping-jobs/${legA.id}/pickup-photo/confirm`, { photoKeys: [keyA] })).status).toBe(201);

    const senderB = await fundedSender();
    const courierB = await makeCourier('STANN_CREEK');
    const shipmentB = await book(senderB.cookies);
    const legB = await assignedFirstMile(shipmentB.id, courierB);

    // Courier B — a real, legitimately assigned courier, just on the OTHER
    // shipment — cannot reach shipment A's leg at all.
    const crossLegRead = await get(courierB.cookies, `driver/shipping-jobs/${legA.id}`);
    expect(crossLegRead.status).toBe(404);
    const crossConfirm = await post(courierB.cookies, `driver/shipping-jobs/${legA.id}/pickup-photo/confirm`, { photoKeys: [keyA] });
    expect(crossConfirm.status).toBe(404);

    // Sender B — a real, legitimately paying customer, just on the OTHER
    // shipment — cannot look up shipment A's reference to see its photo.
    const crossSenderRead = await get(senderB.cookies, `shipping/${shipmentA.reference}`);
    expect(crossSenderRead.status).toBe(404);

    // Shipment B's own (photo-less) leg is unaffected by any of the above.
    const legBRow = await legRow(legB.id);
    expect(legBRow.handoffPhotoKeys).toEqual([]);
  });

  it('4 · an impostor holding a driver profile — but not THIS leg\'s — cannot attach a photo to someone else\'s pickup (BMPL-174/187 shape)', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const impostor = await makeCourier('STANN_CREEK'); // a real, approved, unrelated driver
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    const impostorKey = await uploadPickupPhoto(impostor, firstMile.id);
    const r = await post(impostor.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [impostorKey] });
    expect(r.status).toBe(404); // ownedLeg: 404, not 403 — never confirms the leg exists to a non-owner

    expect((await legRow(firstMile.id)).handoffPhotoKeys).toEqual([]);

    // No side effect on the real courier: they can still attach their own.
    const key = await uploadPickupPhoto(courier, firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [key] })).status).toBe(201);
  });

  it('5 · a storage key uploaded under a DIFFERENT driver\'s namespace is refused even on the courier\'s own leg', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const otherDriver = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    // otherDriver's own, validly-uploaded key — just not this courier's.
    const foreignKey = await uploadPickupPhoto(otherDriver, firstMile.id);
    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [foreignKey] });
    expect(r.status).toBe(400);
    expect((await legRow(firstMile.id)).handoffPhotoKeys).toEqual([]);
  });

  it('6 · a leg that already completed refuses a late photo attach', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const pin = (await legRow(firstMile.id)).handoffPin!;
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin, receivedByName: 'Terminal desk' })).status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');

    const key = await uploadPickupPhoto(courier, firstMile.id);
    const r = await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [key] });
    expect(r.status).toBe(400);
  });

  it('7 · the sender cannot upload or confirm a pickup photo — that route is driver-only', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    const upload = await uploadRaw(sender.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/upload`, PNG);
    expect(upload.status).toBe(403);
    const confirm = await post(sender.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: ['x'] });
    expect(confirm.status).toBe(403);
  });

  it('8 · an unrelated operator with no driver profile cannot confirm a pickup photo either', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    const opsOnly = await makeOperator(['logistics.operate']);
    const r = await post(opsOnly.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: ['x'] });
    // Not even the RolesGuard is satisfied — this account holds no DELIVERY_DRIVER role.
    expect(r.status).toBe(403);
  });

  it('9 · the public recipient tracking link never carries the photo — the allowlist stays exactly as small as it was', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);
    const key = await uploadPickupPhoto(courier, firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [key] })).status).toBe(201);

    const track = await request(ctx.server).get(`/api/shipping/track/${shipment.recipientTrackingToken}`);
    expect(track.status).toBe(200);
    expect(JSON.stringify(track.body)).not.toContain('pickupPhotoUrl');
    expect(JSON.stringify(track.body)).not.toContain(key);
  });

  it('10 · PER-LEG, NOT POOLED: a photo attached to one leg does not appear on its sibling legs of the same shipment', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const firstMile = await assignedFirstMile(shipment.id, courier);

    // This DOOR_TO_DOOR route (Placencia -> Belize City -> San Pedro) genuinely
    // produces multiple legs — FIRST_MILE, two LINE_HAUL hops, and LAST_MILE —
    // so there is at least one sibling leg to prove stays untouched.
    const allLegs = await legsOf(shipment.id);
    expect(allLegs.length).toBeGreaterThan(1);

    const key = await uploadPickupPhoto(courier, firstMile.id);
    expect((await post(courier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup-photo/confirm`, { photoKeys: [key] })).status).toBe(201);

    // A regression that pools every leg's photo keys into one shared URL list
    // (handed identically to every leg) would still pass test 2's assertions
    // on the photographed leg alone — only checking the siblings catches it.
    const senderView = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(senderView.status).toBe(200);
    const senderSiblingLegs = senderView.body.legs.filter((l: { id: string }) => l.id !== firstMile.id);
    expect(senderSiblingLegs.length).toBe(allLegs.length - 1);
    for (const l of senderSiblingLegs) expect(l.pickupPhotoUrls).toEqual([]);

    const staffView = await get(admin, `admin/logistics/shipments/${shipment.reference}`);
    expect(staffView.status).toBe(200);
    const staffSiblingLegs = staffView.body.legs.filter((l: { id: string }) => l.id !== firstMile.id);
    expect(staffSiblingLegs.length).toBe(allLegs.length - 1);
    for (const l of staffSiblingLegs) expect(l.pickupPhotoUrls).toEqual([]);

    // And the photographed leg itself still carries its own photo.
    expect(senderView.body.legs.find((l: { id: string }) => l.id === firstMile.id).pickupPhotoUrls).toHaveLength(1);
  });
});
