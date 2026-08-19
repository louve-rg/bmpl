/**
 * Who can talk to whom about a parcel, against real Postgres.
 *
 * A shipment crosses the country through two different drivers. The question
 * this suite answers is the one that matters for privacy: does taking the FIRST
 * leg give a driver any reach into the LAST leg, or into a customer they are not
 * carrying for?
 *
 * The boundary is structural rather than a rule somebody has to remember — a
 * conversation's context is the LEG, not the shipment — but "structural" is a
 * claim, and this is where it gets checked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

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
  const { cookies, userId } = await registerUser(`msgdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: false, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: 'BELIZE', licenceNumber: `MSG-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'T', model: 'C',
      licencePlate: `MG-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const d of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id };
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
    });
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  for (const r of [
    { from: 'PLA', to: 'MUN', price: 8000 },
    { from: 'MUN', to: 'SPA', price: 6000 },
  ]) {
    await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: 45, priceMinor: r.price, carrierName: 'Tropic Air',
    });
  }
}

async function enableDispatch(on = true) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: on, dispatchOfferTimeoutSeconds: 900, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 5 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book(cookies = customer, body: object = doorToDoor()) {
  const r = await post(cookies, 'shipping', body);
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

const pinOf = async (legId: string) =>
  (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;

/** Which conversation belongs to this leg, if one has been opened. */
const threadFor = (legId: string) =>
  ctx.prisma.conversation.findFirst({ where: { contextType: 'SHIPMENT_LEG', contextId: legId } });

async function flyLineHaul(legId: string) {
  await post(admin, `admin/logistics/legs/${legId}/depart`, {});
  await post(admin, `admin/logistics/legs/${legId}/arrive`, {});
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter' });
  expect(r.status).toBe(201);
}

async function driveLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`);
  await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`);
  await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`);
  const r = await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Receiver',
  });
  expect(r.status).toBe(201);
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
  await ctx.prisma.message.deleteMany();
  await ctx.prisma.conversationParticipant.deleteMany();
  await ctx.prisma.conversation.deleteMany();
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`msgcust_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  await enableDispatch(true);
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('a thread opens on acceptance, and not before', () => {
  it('does not open one for a driver who has only been offered the job', async () => {
    // A rolling offer can touch several drivers in turn. Enrolling each of them
    // would accumulate strangers in a customer's conversation.
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(await threadFor(first.id)).toBeNull();
  });

  it('opens exactly one, in the SHIPMENT_LEG context, once the driver accepts', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const threads = await ctx.prisma.conversation.findMany({ where: { contextId: first.id } });
    expect(threads).toHaveLength(1);
    expect(threads[0]!.contextType).toBe('SHIPMENT_LEG');
    // One pairing, because a shipment has no vendor — only a customer and a driver.
    expect(threads[0]!.pairing).toBe('CUSTOMER_DRIVER');
  });

  it('gives the customer and the driver their correct participant roles', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const thread = (await threadFor(first.id))!;
    const parts = await ctx.prisma.conversationParticipant.findMany({ where: { conversationId: thread.id } });
    const byUser = Object.fromEntries(parts.map((p) => [p.userId, p.role]));
    expect(byUser[customerId]).toBe('CUSTOMER');
    expect(byUser[driver.userId]).toBe('DRIVER');
    expect(parts).toHaveLength(2);
  });

  it('leaves no thread behind when a driver declines', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const holderId = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } })).assignedDriverProfileId;
    const holder = holderId === a.driverProfileId ? a : b;

    await post(holder.cookies, `driver/shipping-jobs/${first.id}/decline`, { reason: 'Too far.' });
    // Declining never created a thread, and re-offering must not have made one
    // for the driver who said no.
    const threads = await ctx.prisma.conversation.findMany({ where: { contextId: first.id } });
    for (const t of threads) {
      const parts = await ctx.prisma.conversationParticipant.findMany({ where: { conversationId: t.id } });
      expect(parts.map((p) => p.userId)).not.toContain(holder.userId);
    }
  });
});

describe('the customer and their driver can actually talk', () => {
  it('lets the accepted driver send, and the customer reply', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;

    expect((await post(driver.cookies, `conversations/${thread.id}/messages`, { body: 'On my way to collect.' })).status).toBe(201);
    expect((await post(customer, `conversations/${thread.id}/messages`, { body: 'Blue gate, thanks.' })).status).toBe(201);

    const read = await get(customer, `conversations/${thread.id}`);
    expect(read.status).toBe(200);
    expect(read.body.messages.map((m: { body: string }) => m.body)).toEqual(
      expect.arrayContaining(['On my way to collect.', 'Blue gate, thanks.']),
    );
  });

  it('shows the thread in the customer\'s own conversation list', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const list = await get(customer, 'conversations');
    expect(list.status).toBe(200);
    const thread = (await threadFor(first.id))!;
    expect(list.body.map((c: { id: string }) => c.id)).toContain(thread.id);
  });
});

describe('one leg does not open a door onto another', () => {
  /** Run a door-to-door shipment as far as the last mile, with two drivers. */
  async function twoLegShipment() {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;

    // Force the first leg onto firstDriver so the two roles are unambiguous.
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);

    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    // Whoever dispatch offered the last mile to — make it a DIFFERENT driver.
    const lastDriver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({
      where: { id: last.id },
      data: { assignedDriverProfileId: lastDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/accept`);
    return { s, first, last, firstDriver, lastDriver };
  }

  it('keeps the first-mile driver out of the last-mile conversation', async () => {
    // The privacy claim that matters: collecting a parcel in Placencia gives a
    // driver no reach into the conversation about delivering it in San Pedro.
    const { last, firstDriver } = await twoLegShipment();
    const lastThread = (await threadFor(last.id))!;

    expect((await get(firstDriver.cookies, `conversations/${lastThread.id}`)).status).toBe(404);
    expect((await post(firstDriver.cookies, `conversations/${lastThread.id}/messages`, { body: 'hello' })).status).toBe(404);
  });

  it('keeps the last-mile driver out of the first-mile conversation', async () => {
    const { first, lastDriver } = await twoLegShipment();
    const firstThread = (await threadFor(first.id))!;
    expect((await get(lastDriver.cookies, `conversations/${firstThread.id}`)).status).toBe(404);
  });

  it('gives each leg its own thread, never a shared one', async () => {
    const { first, last } = await twoLegShipment();
    const firstThread = (await threadFor(first.id))!;
    const lastThread = (await threadFor(last.id))!;
    expect(firstThread.id).not.toBe(lastThread.id);
    expect(firstThread.contextId).toBe(first.id);
    expect(lastThread.contextId).toBe(last.id);
  });

  it('scopes messages to their own leg', async () => {
    const { first, last, firstDriver, lastDriver } = await twoLegShipment();
    const firstThread = (await threadFor(first.id))!;
    const lastThread = (await threadFor(last.id))!;
    await post(firstDriver.cookies, `conversations/${firstThread.id}/messages`, { body: 'FIRST MILE ONLY' });
    await post(lastDriver.cookies, `conversations/${lastThread.id}/messages`, { body: 'LAST MILE ONLY' });

    const lastRead = await get(lastDriver.cookies, `conversations/${lastThread.id}`);
    const bodies = lastRead.body.messages.map((m: { body: string }) => m.body).join(' ');
    expect(bodies).toContain('LAST MILE ONLY');
    expect(bodies).not.toContain('FIRST MILE ONLY');
  });

  it('still lets the customer see both — they are one party to the whole journey', async () => {
    const { first, last } = await twoLegShipment();
    expect((await get(customer, `conversations/${(await threadFor(first.id))!.id}`)).status).toBe(200);
    expect((await get(customer, `conversations/${(await threadFor(last.id))!.id}`)).status).toBe(200);
  });
});

describe('strangers stay out', () => {
  async function acceptedFirstLeg() {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: driver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    return { s, first, driver, thread: (await threadFor(first.id))! };
  }

  it('refuses a driver with no connection to the shipment', async () => {
    const { thread } = await acceptedFirstLeg();
    const stranger = await makeDriver();
    expect((await get(stranger.cookies, `conversations/${thread.id}`)).status).toBe(404);
    expect((await post(stranger.cookies, `conversations/${thread.id}/messages`, { body: 'hi' })).status).toBe(404);
  });

  it('refuses a driver carrying a DIFFERENT shipment', async () => {
    // Being a driver on the platform is not membership of every parcel's thread.
    const { thread } = await acceptedFirstLeg();
    const otherCustomer = await registerUser(`other_${uniq()}@example.com`);
    const otherDriver = await makeDriver();
    const otherShipment = await book(otherCustomer.cookies);
    const otherFirst = (await legsOf(otherShipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: otherFirst.id },
      data: { assignedDriverProfileId: otherDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await post(otherDriver.cookies, `driver/shipping-jobs/${otherFirst.id}/accept`);

    expect((await get(otherDriver.cookies, `conversations/${thread.id}`)).status).toBe(404);
  });

  it('refuses a customer from a different shipment', async () => {
    const { thread } = await acceptedFirstLeg();
    const other = await registerUser(`nosy_${uniq()}@example.com`);
    expect((await get(other.cookies, `conversations/${thread.id}`)).status).toBe(404);
  });

  it('refuses a signed-out visitor', async () => {
    const { thread } = await acceptedFirstLeg();
    expect((await request(ctx.server).get(`/api/conversations/${thread.id}`)).status).toBe(401);
  });

  it('does not make the named recipient a participant', async () => {
    // The recipient is snapshot text on the shipment, not an account. Even if
    // somebody registers with that name, they are not in the conversation.
    const { thread } = await acceptedFirstLeg();
    const parts = await ctx.prisma.conversationParticipant.findMany({ where: { conversationId: thread.id } });
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.userId === customerId || p.role === 'DRIVER')).toBe(true);
  });
});

describe('a driver who is no longer carrying it cannot keep talking', () => {
  it('stops an ex-driver sending once the leg moves to someone else', async () => {
    // The delivery threads already enforce this. A shipment leg must too — the
    // guard is what stops a driver who has handed the parcel on from staying in
    // a customer's conversation indefinitely.
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: driver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null },
    });
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;
    expect((await post(driver.cookies, `conversations/${thread.id}/messages`, { body: 'still mine' })).status).toBe(201);

    // Operations move the leg to another driver.
    const replacement = await makeDriver();
    await ctx.prisma.shipmentLeg.update({
      where: { id: first.id },
      data: { assignedDriverProfileId: replacement.driverProfileId },
    });

    const after = await post(driver.cookies, `conversations/${thread.id}/messages`, { body: 'not mine any more' });
    expect(after.status).toBe(403);
  });
});
