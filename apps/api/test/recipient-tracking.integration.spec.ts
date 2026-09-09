/**
 * The recipient's public tracking link, against real Postgres.
 *
 * The claim this suite exists to defend, in the owner's words: DO NOT EXPOSE
 * PRIVATE CUSTOMER, ORDER OR WALLET INFORMATION THROUGH PUBLIC TRACKING. The
 * link is unauthenticated by definition — anyone holding it is the audience —
 * so the tests here attack the payload (nothing private may appear, however
 * rich the shipment's state) and the address space (a wrong token must be
 * indistinguishable from a shipment that never existed).
 *
 * The positive half matters too: the link must actually tell the recipient
 * the one story they need — something is coming, where it stands, and where
 * to collect it once it is waiting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
/** Anonymous on purpose: the whole point of the link is that it needs no account. */
const publicTrack = (token: string) => request(ctx.server).get(`/api/shipping/track/${token}`);

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
  const { cookies, userId } = await registerUser(`rtdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'Delia River',
      displayName: `Rtv${s}`,
      phone: '+5016000000',
      homeDistrict: 'STANN_CREEK',
      licenceNumber: `RTL-${s}`,
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
      licencePlate: `RT-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
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
      courierFeeMinor: h.fee, instructions: 'Counter beside the departure gate.',
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

const SENDER = { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk Street', name: 'Sonia Sender', phone: '501-2223333' };
const RECIPIENT = { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Rory Recipient', phone: '501-4445555' };

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { ...SENDER },
  destination: { ...RECIPIENT },
  preferredMode: 'AIR',
  description: 'Prescription refill',
});

async function book(body: object = doorToDoor()) {
  const r = await post(customer, 'shipping', { ...body, payWithWallet: true });
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

async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

async function flyLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/** A syntactically plausible token that matches nothing. */
const missToken = () => Array.from({ length: 24 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

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
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`rtcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Recipient tracking fixture.' });
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('the link exists and works', () => {
  it('booking mints a share token, the customer sees it, and the link resolves with no account', async () => {
    const s = await book();
    expect(s.recipientTrackingToken).toMatch(/^[A-Z2-9]{24}$/);

    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    expect(r.body.reference).toBe(s.reference);
    expect(r.body.statusLabel).toBe('Waiting to be collected');
    expect(r.body.destination).toEqual({ city: 'San Pedro', district: 'BELIZE' });
    expect(r.body.collectionHub).toBeNull();
    expect(Array.isArray(r.body.steps)).toBe(true);
    expect(r.body.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.body.steps[0].completed).toBe(false);
  });

  it('progress flows through: a completed first mile reads as completed, and the current step moves on', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    await driveCourierLeg(driver, first.id);

    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    expect(r.body.statusLabel).toBe('At the departure terminal');
    expect(r.body.steps[0].completed).toBe(true);
    expect(r.body.steps[0].completedAt).not.toBeNull();
    expect(r.body.steps[1].isCurrent).toBe(true);
  });

  it('a hub-ending journey shows the collection terminal exactly when there is something to collect', async () => {
    const driver = await makeDriver();
    const s = await book({
      service: 'DOOR_TO_HUB',
      origin: { ...SENDER },
      destination: { hubId: hub.SPA, name: RECIPIENT.name, phone: RECIPIENT.phone },
      preferredMode: 'AIR',
      description: 'Prescription refill',
    });
    const rows = await legs(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    await driveCourierLeg(driver, first.id);
    for (const haul of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(haul.id);

    const waiting = await publicTrack(s.recipientTrackingToken);
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe('AWAITING_COLLECTION');
    expect(waiting.body.collectionHub).toEqual({
      name: 'San Pedro Airstrip',
      city: 'San Pedro',
      address: null,
      instructions: 'Counter beside the departure gate.',
    });

    expect((await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Rory Recipient' })).status).toBe(201);
    const done = await publicTrack(s.recipientTrackingToken);
    expect(done.body.status).toBe('DELIVERED');
    expect(done.body.deliveredAt).not.toBeNull();
    // The moment there is nothing left to collect, the counter details go too.
    expect(done.body.collectionHub).toBeNull();
  });

  it('a cancelled shipment says cancelled — and never why', async () => {
    const s = await book();
    expect((await post(customer, `shipping/${s.id}/cancel`, { reason: 'Recipient moved abroad, order obsolete.' })).status).toBe(201);
    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    expect(r.body.statusLabel).toBe('Cancelled');
    expect(JSON.stringify(r.body)).not.toContain('moved abroad');
  });
});

describe('the payload is an allowlist — nothing private, however rich the state', () => {
  it('never carries the sender, the money, the parcel description, the PIN, or the driver', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${first.id}/pickup`)).status).toBe(201);

    const pin = await pinOf(first.id);
    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    const raw = JSON.stringify(r.body);

    // The sender's identity and address were typed for delivery, not publication.
    expect(raw).not.toContain('Sonia Sender');
    expect(raw).not.toContain('501-2223333');
    expect(raw).not.toContain('1 Sidewalk Street');
    // The recipient's own details do not echo back through a shareable URL either.
    expect(raw).not.toContain('501-4445555');
    expect(raw).not.toContain('5 Barrier Reef Drive');
    // Money is the customer's business.
    expect(raw).not.toContain('Minor');
    // The description is customer-typed and can be sensitive.
    expect(raw).not.toContain('Prescription');
    // A leaked link must not be able to complete a handoff.
    expect(raw).not.toContain(pin);
    expect(raw).not.toContain('handoffPin');
    // No custody actors, no driver identity, no internal flags.
    expect(raw).not.toContain('custody');
    expect(raw).not.toContain('Delia River');
    expect(raw).not.toContain('isTest');
  });

  it('never carries an operator-typed exception reason — label only', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect((await assign(first.id, driver)).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${first.id}/exception`, {
      reason: 'Sender is a known fraud account, holding for review.',
    })).status).toBe(201);

    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    expect(r.body.statusLabel).toBe('Needs attention');
    expect(JSON.stringify(r.body)).not.toContain('fraud');
  });
});

describe('the address space gives nothing away', () => {
  it('a wrong token is byte-identical to one that never existed', async () => {
    const s = await book();
    // A real shipment's token with one character flipped...
    const near: string = s.recipientTrackingToken;
    const flipped = (near[0] === 'A' ? 'B' : 'A') + near.slice(1);
    // ...and pure noise.
    const noise = missToken();

    const a = await publicTrack(flipped);
    const b = await publicTrack(noise);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    // Byte-identical: nothing distinguishes "near miss on a real shipment"
    // from "no such thing", so guessing confirms nothing.
    expect(a.body).toEqual(b.body);
    expect(JSON.stringify(a.body)).not.toContain(s.reference);
  });

  it('the reference is not a token: tracking by reference stays owner-only', async () => {
    const s = await book();
    // Anonymous, by reference — the public surface must not accept it.
    expect((await publicTrack(s.reference)).status).toBe(404);
    // And the authenticated reference route still demands the owner.
    expect((await request(ctx.server).get(`/api/shipping/${s.reference}`)).status).toBe(401);
  });

  it('a shipment from before the column has no link, and says so only to its owner', async () => {
    const s = await book();
    // Simulate a row booked before the migration: the token is nulled the way
    // a pre-existing row would simply never have had one. (Bootstrap-category
    // raw write: no product path removes a token, by design.)
    await ctx.prisma.shipment.update({ where: { id: s.id }, data: { recipientToken: null } });
    const mine = await request(ctx.server).get('/api/shipping').set('Cookie', customer);
    expect(mine.status).toBe(200);
    expect(mine.body[0].recipientTrackingToken).toBeNull();
  });
});
