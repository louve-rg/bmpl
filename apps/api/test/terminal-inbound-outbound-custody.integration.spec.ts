/**
 * MDF-700 (TERM-INBOUND): the three reads `terminal/queue` deliberately does
 * not cover — `GET terminal/inbound` (legs scheduled or in motion toward my
 * hubs, not yet arrived), `GET terminal/outbound` (legs leaving my hubs, not
 * yet departed/released), and `GET terminal/custody` (what a hub physically
 * holds right now, derived from `CustodyEvent`, not from leg/shipment
 * status). Fixtures mirror terminal-queue.integration.spec.ts's own SEA
 * network and terminal-staff helpers.
 *
 * All three return `{ items, hasMore }`, never a bare array — the explicit
 * overflow marker `terminalQueue`'s own silent `take: 100`/`200` does not
 * have. `hasMore` is only exercised for its default-false shape here; this
 * suite does not create 200+ rows to force a true overflow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

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

/** Same fresh two-hub water-taxi network as terminal-queue.integration.spec.ts. */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const originCity = `SP ${tag}`;
  const destinationCity = `BC ${tag}`;
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `San Pedro Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: originCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1500,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Belize City Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: destinationCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  });
  expect(route.status).toBe(201);
  return { originHubId: origin.body.id as string, destinationHubId: destination.body.id as string, originCity, destinationCity };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'MDF-700 test fixture.' });
  return cookies;
}

async function bookDoorToDoor(cookies: string[], net: { originCity: string; destinationCity: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function pinOf(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}

async function completeFirstMileAsAdmin(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/start`, {})).status).toBe(201);
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

async function completeLineHaulAsAdmin(legId: string) {
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

async function makeTerminalStaff(hubIds: string[]) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`staff_${s}@example.com`);
  const company = await ctx.prisma.terminalCompanyProfile.create({
    data: { businessName: `Reef Terminals ${s}`, contactEmail: `reef_${s}@example.com`, isActive: true, isTest: false },
  });
  const member = await ctx.prisma.terminalCompanyMember.create({
    data: { terminalCompanyId: company.id, userId, memberRole: 'OPERATOR', status: 'ACTIVE' },
  });
  const locationIds: string[] = [];
  for (const hubId of hubIds) {
    const location = await ctx.prisma.terminalCompanyLocation.create({ data: { terminalCompanyId: company.id, hubId, isActive: true } });
    await ctx.prisma.terminalCompanyMemberLocation.create({ data: { memberId: member.id, locationId: location.id } });
    locationIds.push(location.id);
  }
  return { cookies, userId, companyId: company.id, memberId: member.id, locationIds };
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

describe('MDF-700: GET terminal/inbound — scheduled or in motion toward my hubs, not yet arrived', () => {
  it('shows a LINE_HAUL leg still READY (not yet departed) — the gap terminalQueue leaves', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const firstMile = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await completeFirstMileAsAdmin(firstMile.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect(lineHaul.status).toBe('READY');

    const res = await get(destStaff.cookies, 'terminal/inbound');
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    const item = res.body.items.find((i: { legId: string }) => i.legId === lineHaul.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.destinationHubId);
    expect(item.departed).toBe(false);
    expect(item.isTest).toBe(false);

    // Still shows once in motion (IN_PROGRESS, departed but not arrived) — widened, not replaced.
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    const stillThere = await get(destStaff.cookies, 'terminal/inbound');
    const inMotion = stillThere.body.items.find((i: { legId: string }) => i.legId === lineHaul.id);
    expect(inMotion).toBeDefined();
    expect(inMotion.departed).toBe(true);

    // Drops off once arrived — arrival is terminalQueue's ARRIVE/HANDOFF territory, not inbound's.
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
    const gone = await get(destStaff.cookies, 'terminal/inbound');
    expect(gone.body.items.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
  });

  it('is scoped to the destination hub, not the origin, and not to a hub I was never granted', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const unrelated = await makeTerminalStaff([]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    await completeFirstMileAsAdmin((await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!.id);

    expect((await get(originStaff.cookies, 'terminal/inbound')).body.items).toEqual([]);
    expect((await get(unrelated.cookies, 'terminal/inbound')).body.items).toEqual([]);
  });

  it('a plain customer is refused outright', async () => {
    expect((await get(await fundedSender(), 'terminal/inbound')).status).toBe(403);
  });
});

describe('MDF-700: GET terminal/outbound — leaving my hubs, not yet departed or released', () => {
  it('shows a LINE_HAUL leg not yet departed', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    await completeFirstMileAsAdmin((await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;

    const res = await get(originStaff.cookies, 'terminal/outbound');
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    const item = res.body.items.find((i: { legId: string }) => i.legId === lineHaul.id);
    expect(item).toBeDefined();
    expect(item.kind).toBe('LINE_HAUL');
    expect(item.hubId).toBe(net.originHubId);
    expect(item.isTest).toBe(false);

    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await get(originStaff.cookies, 'terminal/outbound')).body.items.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
  });

  it('shows a LAST_MILE leg still waiting for a driver — broader than terminalQueue\'s release-only view', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    await completeFirstMileAsAdmin((await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
    await completeLineHaulAsAdmin(lineHaul.id);
    const lastMile = (await legsOf(s.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect(lastMile.status).toBe('READY');

    // No driver assigned yet — terminalQueue's RELEASE_TO_COURIER only shows
    // once DRIVER_ACCEPTED, so this row is invisible there, but outbound
    // uses pickedUpAt:null and must show it now.
    const res = await get(destStaff.cookies, 'terminal/outbound');
    const item = res.body.items.find((i: { legId: string }) => i.legId === lastMile.id);
    expect(item).toBeDefined();
    expect(item.kind).toBe('LAST_MILE');
    expect(item.hubId).toBe(net.destinationHubId);

    const queue = await get(destStaff.cookies, 'terminal/queue');
    expect(queue.body.some((i: { legId: string }) => i.legId === lastMile.id)).toBe(false);
  });

  it('is scoped to the origin hub, never the destination', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    await completeFirstMileAsAdmin((await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!.id);

    expect((await get(destStaff.cookies, 'terminal/outbound')).body.items).toEqual([]);
  });

  it('a plain customer is refused outright', async () => {
    expect((await get(await fundedSender(), 'terminal/outbound')).status).toBe(403);
  });
});

describe('MDF-700: GET terminal/custody — what a hub physically holds right now', () => {
  it('a shipment handed off at the origin hub is held there, and drops off the moment the line-haul carrier departs with it', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const firstMile = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    // Not held yet — still with the courier, not handed off.
    expect((await get(originStaff.cookies, 'terminal/custody')).body.items.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);

    await completeFirstMileAsAdmin(firstMile.id);
    const held = await get(originStaff.cookies, 'terminal/custody');
    expect(held.status).toBe(200);
    expect(held.body.hasMore).toBe(false);
    const item = held.body.items.find((i: { shipmentId: string }) => i.shipmentId === s.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.originHubId);
    expect(item.isTest).toBe(false);
    expect(item.heldSince).toBeDefined();

    // A parcel that passed through and moved on drops off correctly — the
    // card's own acceptance line for this derivation.
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    const after = await get(originStaff.cookies, 'terminal/custody');
    expect(after.body.items.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);
  });

  it('a shipment ending at a hub (door-to-hub, no last mile) stays held in custody until collected', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToHub(await fundedSender(), net);
    const firstMile = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
    await completeFirstMileAsAdmin(firstMile.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
    const done = await completeLineHaulAsAdmin(lineHaul.id);
    expect(done.status).toBe('AWAITING_COLLECTION');

    const held = await get(destStaff.cookies, 'terminal/custody');
    const item = held.body.items.find((i: { shipmentId: string }) => i.shipmentId === s.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.destinationHubId);

    const code = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { collectionPin: true } }).then((r) => r.collectionPin);
    expect((await post(destStaff.cookies, `terminal/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz', code })).status).toBe(201);

    // Collected — handed to RECIPIENT, so the hub no longer holds it.
    const after = await get(destStaff.cookies, 'terminal/custody');
    expect(after.body.items.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);
  });

  it('is scoped per hub — a staff member at a different hub never sees another location\'s held parcel', async () => {
    const net = await makeNetwork();
    const otherNet = await makeNetwork();
    const wrongStaff = await makeTerminalStaff([otherNet.originHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    await completeFirstMileAsAdmin((await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!.id);

    expect((await get(wrongStaff.cookies, 'terminal/custody')).body.items.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);
  });

  it('a plain customer is refused outright', async () => {
    expect((await get(await fundedSender(), 'terminal/custody')).status).toBe(403);
  });

  it('a brand-new terminal operator with no grants anywhere sees an empty, not-erroring result on all three routes', async () => {
    const staff = await makeTerminalStaff([]);
    for (const path of ['terminal/inbound', 'terminal/outbound', 'terminal/custody']) {
      const res = await get(staff.cookies, path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], hasMore: false });
    }
  });
});
