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
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
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

/** A registered account whose own phone genuinely matches what the sender
 *  typed for the recipient (`doorToDoor()`'s destination.phone) — the
 *  matching-signal rule `claimAsRecipient` enforces (2026-09-30 owner
 *  decision; see shipment-recipient-linking.integration.spec.ts). */
async function registerMatchingRecipient(email: string, phone = '501-4445555') {
  const r = await registerUser(email);
  await ctx.prisma.user.update({ where: { id: r.userId }, data: { phone } });
  return r;
}

/** Claim a shipment as its recipient — the SAME two-step (token + matching
 *  account) BMPL-359's own test-worthy claim already proves elsewhere; this
 *  suite only needs the end state (a genuinely linked recipientUserId). */
async function claimAsRecipient(shipmentId: string, cookies: string[]) {
  const { recipientToken } = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { recipientToken: true } });
  const r = await post(cookies, `shipping/track/${recipientToken}/claim`, {});
  expect(r.status).toBe(201);
}

const openCourierConversation = (cookies: string[], reference: string) => post(cookies, `shipping/incoming/${reference}/courier-conversation`);

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
  const r = await post(cookies, 'shipping', { ...body, payWithWallet: true });
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
  // Settled legs carry driver earnings, and the earning holds the leg with an
  // onDelete: Restrict — you should not be able to delete work somebody was
  // paid for. Clear the earnings first.
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`msgcust_${uniq()}@example.com`);
  customer = c.cookies;
  // Shipping takes payment before it dispatches, so the customer needs a
  // balance. Administrative test credit, not a test-account flag: flagging the
  // account would make every shipment a TEST shipment, which the dispatch
  // boundary correctly refuses to offer to the ordinary drivers here.
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Shipping test fixture.' });
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
    // They book too, so they need a balance like anybody else.
    await post(admin, 'admin/wallet/test-credit', { userId: otherCustomer.userId, amountMinor: 100_000, reason: 'Shipping test fixture.' });
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

describe('the shipment payload names each leg\'s own conversation (BMPL-290)', () => {
  it('is null before a driver accepts, and becomes the thread id once they do', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const before = await get(customer, `shipping/${s.reference}`);
    expect(before.body.legs.find((l: { id: string }) => l.id === first.id).conversationId).toBeNull();

    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;

    const after = await get(customer, `shipping/${s.reference}`);
    expect(after.body.legs.find((l: { id: string }) => l.id === first.id).conversationId).toBe(thread.id);
  });

  it('never puts one leg\'s thread on another leg', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;

    const read = await get(customer, `shipping/${s.reference}`);
    const byId = Object.fromEntries(read.body.legs.map((l: { id: string; conversationId: string | null }) => [l.id, l.conversationId]));
    expect(byId[first.id]).toBe(thread.id);
    // The last-mile leg is not actionable until the first-mile leg completes,
    // so no driver has accepted it yet and it must have no thread of its own —
    // never the first leg's thread borrowed by matching on the wrong key.
    expect(byId[last.id]).toBeNull();
  });

  it('resolves every shipment\'s own legs correctly in the list view, not just the last one queried', async () => {
    // listMine batches this in one query across every shipment on the page —
    // this proves the batch keeps each leg's answer scoped to its own leg,
    // not just that it avoids N+1.
    const driver = await makeDriver();
    const withThread = await book();
    const withoutThread = await book();
    const firstOfWithThread = (await legsOf(withThread.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${firstOfWithThread.id}/accept`);
    const thread = (await threadFor(firstOfWithThread.id))!;

    const list = await get(customer, 'shipping');
    expect(list.status).toBe(200);
    const a = list.body.find((s: { id: string }) => s.id === withThread.id);
    const b = list.body.find((s: { id: string }) => s.id === withoutThread.id);
    expect(a.legs.find((l: { id: string }) => l.id === firstOfWithThread.id).conversationId).toBe(thread.id);
    expect(b.legs.every((l: { conversationId: string | null }) => l.conversationId === null)).toBe(true);
  });

  it('gives staff the same field on the admin tracking view', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;

    const staffRead = await get(admin, `admin/logistics/shipments/${s.reference}`);
    expect(staffRead.status).toBe(200);
    expect(staffRead.body.legs.find((l: { id: string }) => l.id === first.id).conversationId).toBe(thread.id);
  });
});

describe('a genuinely linked recipient can reach the same courier too (BMPL-359)', () => {
  /** Walk a door-to-door shipment all the way to an ACCEPTED last-mile leg —
   *  the only leg kind a recipient may ever reach (see resolveParties' own
   *  comment on why FIRST_MILE/LINE_HAUL are excluded). Shared by every test
   *  below that needs a real, reachable thread, so the walk is written once. */
  async function walkToAcceptedLastMile() {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const lastDriver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({ where: { id: last.id }, data: { assignedDriverProfileId: lastDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/accept`);
    return { s, first, last, lastDriver };
  }

  it('refuses before any driver has ACCEPTED anything — dispatch merely offering the first-mile job is not enough', async () => {
    // assignedDriverProfileId is set the moment dispatch OFFERS a leg, well
    // before acceptance (this file's own first describe block proves it) — the
    // recipient entry point must not race ahead of ensureShipmentLegThread and
    // create a thread for a leg nobody has accepted yet.
    await makeDriver(); // enough for dispatch to offer the first-mile leg to somebody
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    expect(first.assignedDriverProfileId).not.toBeNull();
    expect(await threadFor(first.id)).toBeNull();

    const recipient = await registerMatchingRecipient(`bmpl359a_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const r = await openCourierConversation(recipient.cookies, s.reference);
    expect(r.status).toBe(400); // no LAST_MILE leg exists yet at all, let alone an accepted one
    expect(await threadFor(first.id)).toBeNull(); // still did not create one
  });

  it('refuses once the LAST_MILE leg exists but has not been accepted yet — the precise boundary, not just "nothing exists at all"', async () => {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect(last.assignedDriverProfileId).not.toBeNull(); // dispatch already offered it
    expect(await threadFor(last.id)).toBeNull(); // but nobody has accepted, so no thread yet

    const recipient = await registerMatchingRecipient(`bmpl359h_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);
    expect((await openCourierConversation(recipient.cookies, s.reference)).status).toBe(400);
  });

  it('refuses a user who never claimed the recipient slot at all', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const notLinked = await registerUser(`bmpl359b_${uniq()}@example.com`);
    const r = await openCourierConversation(notLinked.cookies, s.reference);
    expect(r.status).toBe(404);
  });

  it('holding a valid tracking token is not holding the recipient seat — the owner\'s own framing, proved both ways', async () => {
    const { s, last } = await walkToAcceptedLastMile();
    const thread = (await threadFor(last.id))!;
    const { recipientToken } = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientToken: true } });

    // It really is a valid token: the public tracking view accepts it, with
    // no session at all.
    expect((await request(ctx.server).get(`/api/shipping/track/${recipientToken}`)).status).toBe(200);

    // The messaging door is not reachable by a token in the first place —
    // this route takes no token parameter, only @CurrentUser() — so an
    // anonymous token holder cannot even construct a request that could earn
    // a seat. Refused at authentication, before any recipient logic runs.
    expect((await request(ctx.server).post(`/api/shipping/incoming/${s.reference}/courier-conversation`)).status).toBe(401);

    // A real, signed-in account that has READ the token (genuinely holds the
    // tracking link) but never called claim is still refused — reading and
    // claiming are different capabilities, and only claiming links the
    // account as shipment.recipientUserId, which is the only thing
    // openShipmentLegForRecipient trusts.
    const holder = await registerUser(`bmpl359tok_${uniq()}@example.com`);
    expect((await request(ctx.server).get(`/api/shipping/track/${recipientToken}`).set('Cookie', holder.cookies)).status).toBe(200);
    expect((await openCourierConversation(holder.cookies, s.reference)).status).toBe(404);

    // No participant seat was created for the token holder on the real
    // existing thread, by reading the token, by the refused attempt, or by
    // both together.
    const parts = await ctx.prisma.conversationParticipant.findMany({ where: { conversationId: thread.id } });
    expect(parts.map((p) => p.userId)).not.toContain(holder.userId);
    expect(parts).toHaveLength(2); // customer + last-mile driver only
  });

  const getCourierConversation = (cookies: string[] | undefined, reference: string) => {
    const r = request(ctx.server).get(`/api/shipping/incoming/${reference}/courier-conversation`);
    return cookies ? r.set('Cookie', cookies) : r;
  };

  it('the linked recipient reads the open courier conversation id', async () => {
    const { s, last } = await walkToAcceptedLastMile();
    const thread = (await threadFor(last.id))!;
    const recipient = await registerMatchingRecipient(`bmpl359r_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const r = await getCourierConversation(recipient.cookies, s.reference);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ conversationId: thread.id });
  });

  it('the linked recipient reads null — not an error — before any courier has accepted', async () => {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const recipient = await registerMatchingRecipient(`bmpl359s_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const r = await getCourierConversation(recipient.cookies, s.reference);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ conversationId: null });
    expect(await threadFor(last.id)).toBeNull();
  });

  it('a pure read: reading creates no conversation and no participant, whether one is open or not', async () => {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const recipient = await registerMatchingRecipient(`bmpl359p_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const convCount = () => ctx.prisma.conversation.count({ where: { contextType: 'SHIPMENT_LEG', contextId: last.id } });
    const partCount = () => ctx.prisma.conversationParticipant.count({ where: { userId: recipient.userId } });
    const before = [await convCount(), await partCount()];
    expect((await getCourierConversation(recipient.cookies, s.reference)).status).toBe(200);
    expect([await convCount(), await partCount()]).toEqual(before);
  });

  it('a pure read on an OPEN conversation leaves its participant list exactly as it was', async () => {
    const { s, last } = await walkToAcceptedLastMile();
    const thread = (await threadFor(last.id))!;
    const recipient = await registerMatchingRecipient(`bmpl359o_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const parts = () => ctx.prisma.conversationParticipant.count({ where: { conversationId: thread.id } });
    const partsBefore = await parts();
    expect((await getCourierConversation(recipient.cookies, s.reference)).body).toEqual({ conversationId: thread.id });
    expect(await parts()).toBe(partsBefore);
    expect(await ctx.prisma.conversationParticipant.count({ where: { conversationId: thread.id, userId: recipient.userId } })).toBe(0);
  });

  it('holding a valid tracking token is not enough to read it — refused exactly as the POST refuses', async () => {
    const { s, last } = await walkToAcceptedLastMile();
    const { recipientToken } = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientToken: true } });
    expect((await request(ctx.server).get(`/api/shipping/track/${recipientToken}`)).status).toBe(200);

    const holder = await registerUser(`bmpl359rt_${uniq()}@example.com`);
    expect((await request(ctx.server).get(`/api/shipping/track/${recipientToken}`).set('Cookie', holder.cookies)).status).toBe(200);
    const read = await getCourierConversation(holder.cookies, s.reference);
    const write = await openCourierConversation(holder.cookies, s.reference);
    expect(read.status).toBe(404);
    expect(read.status).toBe(write.status);
    expect(read.body).not.toHaveProperty('conversationId');
    expect(await threadFor(last.id)).not.toBeNull();
    expect(await ctx.prisma.conversationParticipant.count({ where: { userId: holder.userId } })).toBe(0);
  });

  it('an anonymous caller is refused at authentication, before any recipient logic runs', async () => {
    const { s } = await walkToAcceptedLastMile();
    expect((await getCourierConversation(undefined, s.reference)).status).toBe(401);
  });

  it('an unrelated signed-in stranger gets the refusal, never a null', async () => {
    const { s } = await walkToAcceptedLastMile();
    const stranger = await registerUser(`bmpl359x_${uniq()}@example.com`);
    const r = await getCourierConversation(stranger.cookies, s.reference);
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty('conversationId');
  });

  it('refuses an account linked as recipient of a DIFFERENT shipment', async () => {
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);

    const otherShipment = await book();
    const otherRecipient = await registerMatchingRecipient(`bmpl359c_${uniq()}@example.com`);
    await claimAsRecipient(otherShipment.id, otherRecipient.cookies);

    const r = await openCourierConversation(otherRecipient.cookies, s.reference);
    expect(r.status).toBe(404);
  });

  it('joins the EXISTING last-mile thread once accepted, becomes a RECIPIENT participant, can send and read, and changes nothing for the customer or driver', async () => {
    const { s, last, lastDriver } = await walkToAcceptedLastMile();
    const thread = (await threadFor(last.id))!;

    const recipient = await registerMatchingRecipient(`bmpl359d_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    const opened = await openCourierConversation(recipient.cookies, s.reference);
    expect(opened.status).toBe(201);
    expect(opened.body.id).toBe(thread.id); // the SAME thread, not a new one

    const parts = await ctx.prisma.conversationParticipant.findMany({ where: { conversationId: thread.id } });
    expect(parts).toHaveLength(3);
    const byUser = Object.fromEntries(parts.map((p) => [p.userId, p.role]));
    expect(byUser[customerId]).toBe('CUSTOMER'); // unchanged by the recipient joining
    expect(byUser[lastDriver.userId]).toBe('DRIVER'); // unchanged by the recipient joining
    expect(byUser[recipient.userId]).toBe('RECIPIENT');

    // The recipient can send; the driver and the customer both see it.
    expect((await post(recipient.cookies, `conversations/${thread.id}/messages`, { body: 'Please leave it with the gate guard.' })).status).toBe(201);
    const driverRead = await get(lastDriver.cookies, `conversations/${thread.id}`);
    expect(driverRead.body.messages.map((m: { body: string }) => m.body)).toContain('Please leave it with the gate guard.');
    const customerRead = await get(customer, `conversations/${thread.id}`);
    expect(customerRead.body.messages.map((m: { body: string }) => m.body)).toContain('Please leave it with the gate guard.');

    // The customer can still send, and the recipient sees it — the existing
    // relationship is additive, never replaced.
    expect((await post(customer, `conversations/${thread.id}/messages`, { body: 'Thanks for coordinating.' })).status).toBe(201);
    const recipientRead = await get(recipient.cookies, `conversations/${thread.id}`);
    expect(recipientRead.body.messages.map((m: { body: string }) => m.body)).toContain('Thanks for coordinating.');

    // Privacy (owner's requirement 7, non-negotiable): the participant list
    // the recipient sees carries only what every other participant list in
    // this module already carries — name, initials, avatar, role, canSend —
    // never a phone number, address, or document.
    const seenParticipants = recipientRead.body.participants as Array<Record<string, unknown>>;
    expect(seenParticipants.length).toBe(3);
    for (const p of seenParticipants) {
      expect(Object.keys(p).sort()).toEqual(['avatarUrl', 'canSend', 'initials', 'name', 'role', 'userId'].sort());
    }
  });

  it('a stranger driver still cannot reach the thread just because a recipient can — the recipient does not widen the driver-privacy boundary', async () => {
    const { s, last } = await walkToAcceptedLastMile();
    const thread = (await threadFor(last.id))!;
    const recipient = await registerMatchingRecipient(`bmpl359e_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);
    expect((await openCourierConversation(recipient.cookies, s.reference)).status).toBe(201);

    const stranger = await makeDriver();
    expect((await get(stranger.cookies, `conversations/${thread.id}`)).status).toBe(404);
  });

  it('reaches the CURRENT (LAST_MILE) leg\'s thread, not a completed earlier one, on a multi-leg journey', async () => {
    const { s, first, last } = await walkToAcceptedLastMile();
    const lastThread = (await threadFor(last.id))!;
    const firstThread = (await threadFor(first.id))!;
    expect(lastThread.id).not.toBe(firstThread.id);

    const recipient = await registerMatchingRecipient(`bmpl359f_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);
    const opened = await openCourierConversation(recipient.cookies, s.reference);
    expect(opened.status).toBe(201);
    expect(opened.body.id).toBe(lastThread.id); // reaches the CURRENT leg...
    expect(opened.body.id).not.toBe(firstThread.id); // ...never the completed one

    // And still cannot reach the completed first-mile thread directly — being
    // a recipient of the shipment is not membership of every leg's own thread.
    expect((await get(recipient.cookies, `conversations/${firstThread.id}`)).status).toBe(404);
  });

  it('refuses the recipient on a FIRST_MILE thread even while it is still live — this leg is the courier\'s coordination with the SENDER, never the recipient', async () => {
    // The sharper version of the multi-leg test above: this is not a
    // completed-history question, it is a kind question. recipientUserId is
    // a SHIPMENT-level field, so WITHOUT a kind guard in resolveParties it
    // would read true for every leg of the shipment, including the one
    // still actively coordinating pickup from the sender's own door.
    const driver = await makeDriver();
    const s = await book();
    const first = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await post(driver.cookies, `driver/shipping-jobs/${first.id}/accept`);
    const thread = (await threadFor(first.id))!;

    const recipient = await registerMatchingRecipient(`bmpl359g_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    expect((await get(recipient.cookies, `conversations/${thread.id}`)).status).toBe(404);
    expect((await post(recipient.cookies, `conversations/${thread.id}/messages`, { body: 'hi' })).status).toBe(404);
    // And the discovery endpoint itself must not resolve to this leg either —
    // there is no LAST_MILE/DIRECT leg yet, so it has nothing to open.
    expect((await openCourierConversation(recipient.cookies, s.reference)).status).toBe(400);
  });
});

describe('a delivered leg does not end the courier conversation (deliberate, pinned)', () => {
  /**
   * Access follows the leg's KIND (last-mile or direct) and the party, never the
   * leg's status. A delivered leg therefore keeps its thread open for the
   * booking customer and the linked recipient. This is the decided behaviour:
   * messaging is BML's default contact channel and no phone numbers are shared,
   * so closing the thread at delivery would leave a recipient with a damaged
   * parcel and no way to reach the courier. These tests pin that choice; a
   * change here must be a deliberate decision, not an accident.
   */
  async function deliveredLastMile() {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const lastDriver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({ where: { id: last.id }, data: { assignedDriverProfileId: lastDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(lastDriver, last.id);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: last.id } })).status).toBe('COMPLETED');
    const thread = (await threadFor(last.id))!;
    return { s, thread, lastDriver };
  }

  it('a delivered leg does not end the conversation: the linked recipient can still READ it — deliberate, not an oversight', async () => {
    const { s, thread } = await deliveredLastMile();
    const recipient = await registerMatchingRecipient(`delivered_r_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    expect((await get(recipient.cookies, `conversations/${thread.id}`)).status).toBe(200);
  });

  it('a delivered leg does not end the conversation: the linked recipient can still SEND on it — deliberate, not an oversight', async () => {
    const { s, thread } = await deliveredLastMile();
    const recipient = await registerMatchingRecipient(`delivered_s_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);

    expect((await post(recipient.cookies, `conversations/${thread.id}/messages`, { body: 'The box arrived damaged.' })).status).toBe(201);
  });

  it('a delivered leg does not end the conversation: the booking customer can still READ it — deliberate, same rule as the recipient', async () => {
    const { thread } = await deliveredLastMile();

    expect((await get(customer, `conversations/${thread.id}`)).status).toBe(200);
  });

  it('a delivered leg does not end the conversation: the booking customer can still SEND on it — deliberate, same rule as the recipient', async () => {
    const { thread } = await deliveredLastMile();

    expect((await post(customer, `conversations/${thread.id}/messages`, { body: 'Thanks, the parcel is here.' })).status).toBe(201);
  });
});

describe('CHARACTERISATION OF CURRENT BEHAVIOUR (not correct behaviour): a replaced driver on a shipment-leg thread', () => {
  /**
   * Walks a last-mile leg to an accepted courier, links a recipient, then moves
   * the leg to a replacement courier. Reassignment is a direct field write, as in
   * the existing ex-driver test above; authorisation reads only that field.
   * Each assertion here records what the code does TODAY. Some of it is a defect
   * (see each test name); none of it is a statement that the behaviour is right.
   */
  async function reassignedLastMile() {
    const firstDriver = await makeDriver();
    const s = await book();
    const rows = await legsOf(s.id);
    const first = rows.find((l) => l.kind === 'FIRST_MILE')!;
    await ctx.prisma.shipmentLeg.update({ where: { id: first.id }, data: { assignedDriverProfileId: firstDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    await driveLeg(firstDriver, first.id);
    for (const lh of rows.filter((l) => l.kind === 'LINE_HAUL')) await flyLineHaul(lh.id);
    const last = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    const oldDriver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({ where: { id: last.id }, data: { assignedDriverProfileId: oldDriver.driverProfileId, courierStatus: 'ASSIGNED', acceptedAt: null } });
    expect((await post(oldDriver.cookies, `driver/shipping-jobs/${last.id}/accept`)).status).toBe(201);
    const thread = (await threadFor(last.id))!;
    const recipient = await registerMatchingRecipient(`charac_r_${uniq()}@example.com`);
    await claimAsRecipient(s.id, recipient.cookies);
    const newDriver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({ where: { id: last.id }, data: { assignedDriverProfileId: newDriver.driverProfileId } });
    return { thread, oldDriver, newDriver, recipient };
  }

  it('open owner question (MDF-111), not deliberate: a replaced driver can still READ the thread, while being refused a SEND', async () => {
    const { thread, oldDriver } = await reassignedLastMile();
    expect((await get(oldDriver.cookies, `conversations/${thread.id}`)).status).toBe(200);
    expect((await post(oldDriver.cookies, `conversations/${thread.id}/messages`, { body: 'still here' })).status).toBe(403);
  });

  it('a replaced driver who created the thread is refused CLOSE, so the recipient and the current courier can still send', async () => {
    const { thread, oldDriver, newDriver, recipient } = await reassignedLastMile();
    expect((await post(oldDriver.cookies, `conversations/${thread.id}/close`, {})).status).toBe(403);
    expect((await post(recipient.cookies, `conversations/${thread.id}/messages`, { body: 'hello?' })).status).toBe(201);
    expect((await post(newDriver.cookies, `conversations/${thread.id}/messages`, { body: 'on it' })).status).toBe(201);
  });

  it('a replaced driver who created the thread is refused REOPEN after the current courier closes it', async () => {
    const { thread, oldDriver, newDriver, recipient } = await reassignedLastMile();
    expect((await post(newDriver.cookies, `conversations/${thread.id}/close`, {})).status).toBe(201);
    expect((await post(oldDriver.cookies, `conversations/${thread.id}/reopen`, {})).status).toBe(403);
    expect((await post(recipient.cookies, `conversations/${thread.id}/messages`, { body: 'still closed?' })).status).toBe(403);
  });

  it('the courier who currently holds the leg CAN close the thread created by the driver they replaced', async () => {
    const { thread, newDriver } = await reassignedLastMile();
    expect((await post(newDriver.cookies, `conversations/${thread.id}/close`, {})).status).toBe(201);
  });

  it('today: the recipient cannot CLOSE the courier thread', async () => {
    const { thread, recipient } = await reassignedLastMile();
    expect((await post(recipient.cookies, `conversations/${thread.id}/close`, {})).status).toBe(403);
  });

  it('today: the recipient cannot REOPEN a thread once it has been closed', async () => {
    const { thread, newDriver, recipient } = await reassignedLastMile();
    expect((await post(newDriver.cookies, `conversations/${thread.id}/close`, {})).status).toBe(201);
    expect((await post(recipient.cookies, `conversations/${thread.id}/reopen`, {})).status).toBe(403);
  });
});
