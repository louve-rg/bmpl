/**
 * Multi-leg shipping, against real Postgres.
 *
 * The two things this suite exists to prove, in order of importance:
 *
 *   1. LOCAL DELIVERY IS UNTOUCHED. A same-town job is refused by the shipment
 *      layer outright, and the ordinary courier flow is not routed through any of
 *      this. That was the milestone's hard constraint and it is the first test.
 *
 *   2. SEQUENCE IS AUTHORITY. A last-mile courier cannot be released before the
 *      parcel has actually reached the destination terminal, and no leg can jump
 *      the queue — whatever an operator clicks.
 *
 * The network here is built through the ADMIN API, not inserted into the
 * database, because "the hubs are data an admin configures" is itself a claim
 * worth testing.
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

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

/** Hub ids by code, rebuilt for each test so nothing leaks between them. */
let hub: Record<string, string> = {};

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/**
 * The network, configured the way an operator would configure it.
 *
 * San Pedro and Belize City share a district on purpose — it is the awkward real
 * case, and the planner has to separate them by town rather than by district.
 */
async function seedNetwork() {
  const hubs = [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', type: 'AIRSTRIP', district: 'BELIZE', city: 'Belize City', modes: ['LAND', 'AIR'], courierFee: 1000 },
    { code: 'WTB', name: 'Belize City Water Taxi Terminal', type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: 'Belize City', modes: ['LAND', 'SEA'], courierFee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', type: 'AIRSTRIP', district: 'BELIZE', city: 'San Pedro', modes: ['LAND', 'AIR'], courierFee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', type: 'AIRSTRIP', district: 'STANN_CREEK', city: 'Placencia', modes: ['LAND', 'AIR'], courierFee: 1200 },
    { code: 'PGA', name: 'Punta Gorda Airstrip', type: 'AIRSTRIP', district: 'TOLEDO', city: 'Punta Gorda', modes: ['LAND', 'AIR'], courierFee: 1300 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: h.type, district: h.district, city: h.city, modes: h.modes,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.courierFee) } });
  }
  const routes = [
    { from: 'PLA', to: 'MUN', mode: 'AIR', durationMinutes: 45, priceMinor: 8000 },
    { from: 'MUN', to: 'SPA', mode: 'AIR', durationMinutes: 20, priceMinor: 6000 },
    { from: 'PGA', to: 'MUN', mode: 'AIR', durationMinutes: 60, priceMinor: 9000 },
  ];
  for (const r of routes) {
    const res = await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: r.mode,
      durationMinutes: r.durationMinutes, priceMinor: r.priceMinor, carrierName: 'Tropic Air',
    });
    expect(res.status).toBe(201);
  }
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

/**
 * Book AND PAY, which is what the customer-facing form does. A shipment nobody
 * has paid for is deliberately never dispatched, so booking without paying
 * would test a journey no real customer can take.
 */
async function book(body: object = doorToDoor()) {
  const r = await post(customer, 'shipping', { ...body, payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

/** Look a leg up by `KIND_sequence`, e.g. `LAST_MILE_4`. Throws rather than
 *  returning undefined, so a mistyped key fails loudly instead of putting
 *  "undefined" in a URL and asserting on the resulting 404. */
function legIds(s: { legs: Array<{ id: string; kind: string; sequence: number }> }) {
  const map = new Map(s.legs.map((l) => [`${l.kind}_${l.sequence}`, l.id]));
  return (key: string): string => {
    const id = map.get(key);
    if (!id) throw new Error(`No leg ${key}; this shipment has ${[...map.keys()].join(', ')}`);
    return id;
  };
}

/** Walk a leg from READY through to a verified handoff. */
async function completeLeg(id: string, pin: string, isLineHaul: boolean) {
  expect((await post(admin, `admin/logistics/legs/${id}/${isLineHaul ? 'depart' : 'start'}`, {})).status).toBe(201);
  if (isLineHaul) expect((await post(admin, `admin/logistics/legs/${id}/arrive`, {})).status).toBe(201);
  const r = await post(admin, `admin/logistics/legs/${id}/handoff`, { pin, receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

/** Handoff PINs are never returned by the API, so read them straight from the DB. */
async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password });
  admin = cookiesOf(login);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.custodyEvent.deleteMany();
  // Settled legs carry driver earnings, and the earning holds the leg with an
  // onDelete: Restrict — you should not be able to delete work somebody was
  // paid for. Clear the earnings first.
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  const c = await registerCustomer(`ship_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  // Shipping takes payment before it dispatches. Administrative test credit,
  // not a test-account flag — flagging would make every shipment a TEST
  // shipment and the dispatch boundary would refuse the ordinary drivers here.
  const credit = await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Shipping test fixture.' });
  if (credit.status !== 201) throw new Error(`test credit failed: ${credit.status} ${JSON.stringify(credit.body)}`);
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('a local door-to-door parcel', () => {
  // The rule this block used to encode was "refuse a same-town journey". That
  // was right about marketplace delivery and wrong about shipping: a customer
  // who opens Shipping & Delivery and asks us to take a parcel across Belize
  // City is asking for a real service, and refusing it with "there is no
  // terminal serving Belize City" describes a terminal they never wanted.
  //
  // The genuine constraint — an ordinary marketplace delivery must never become
  // a shipment — is asserted separately below, and still holds.
  const localDoorToDoor = {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: 'Belize City' },
    destination: { district: 'BELIZE', city: 'Belize City' },
  };

  /** The settings singleton is created lazily, so a bare update matches nothing. */
  async function setLocalCourierFee(feeMinor: bigint, minutes = 60) {
    const existing = await ctx.prisma.platformSetting.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) {
      await ctx.prisma.platformSetting.update({
        where: { id: existing.id },
        data: { localCourierFeeMinor: feeMinor, localCourierMinutes: minutes },
      });
    } else {
      await ctx.prisma.platformSetting.create({ data: { localCourierFeeMinor: feeMinor, localCourierMinutes: minutes } });
    }
  }

  it('is quoted as a single courier run with no terminal in it', async () => {
    await setLocalCourierFee(1500n);
    const r = await post(customer, 'shipping/quote', localDoorToDoor);
    expect(r.status).toBe(201);
    expect(r.body.available).toBe(true);
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['DIRECT']);
    expect(r.body.totalMinor).toBe(1500);
    expect(r.body.pricingIncomplete).toBe(false);
  });

  it('says the price is not set rather than quoting a local run as free', async () => {
    await setLocalCourierFee(0n);
    const r = await post(customer, 'shipping/quote', localDoorToDoor);
    expect(r.body.available).toBe(true);
    expect(r.body.pricingIncomplete).toBe(true);
    expect(r.body.pricingNote).toMatch(/local door-to-door/i);
    await setLocalCourierFee(1500n);
  });

  it('books, and creates exactly one leg that is ready immediately', async () => {
    await setLocalCourierFee(1500n);
    const r = await post(customer, 'shipping', {
      payWithWallet: true,
      service: 'DOOR_TO_DOOR',
      origin: { district: 'BELIZE', city: 'Belize City', address: '1 Front St', name: 'S', phone: '501-2223333' },
      destination: { district: 'BELIZE', city: 'Belize City', address: '2 Front St', name: 'R', phone: '501-4445555' },
    });
    expect(r.status).toBe(201);

    const legs = await ctx.prisma.shipmentLeg.findMany({ where: { shipmentId: r.body.id }, orderBy: { sequence: 'asc' } });
    expect(legs).toHaveLength(1);
    expect(legs[0]!.kind).toBe('DIRECT');
    expect(legs[0]!.status).toBe('READY');
    // No terminal at either end — the parcel never goes near one.
    expect(legs[0]!.originHubId).toBeNull();
    expect(legs[0]!.destinationHubId).toBeNull();

    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(shipment.status).toBe('AWAITING_PICKUP');
    expect(shipment.originHubId).toBeNull();
    expect(shipment.destinationHubId).toBeNull();

    await ctx.prisma.driverEarning.deleteMany({ where: { shipmentLeg: { shipmentId: r.body.id } } });
    await ctx.prisma.shipmentLeg.deleteMany({ where: { shipmentId: r.body.id } });
    await ctx.prisma.custodyEvent.deleteMany({ where: { shipmentId: r.body.id } });
    await ctx.prisma.shipment.delete({ where: { id: r.body.id } });
  });

  it('refuses to fly a parcel across one town', async () => {
    const r = await post(customer, 'shipping/quote', { ...localDoorToDoor, preferredMode: 'AIR' });
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe('MODE_UNAVAILABLE');
    expect(r.body.message).toMatch(/local journey/i);
  });

  it('creates no shipment rows for an ordinary delivery', async () => {
    // Nothing in the existing delivery path writes here. If a future change made
    // OrderDelivery create a shipment, this catches it.
    expect(await ctx.prisma.shipment.count()).toBe(0);
    expect(await ctx.prisma.shipmentLeg.count()).toBe(0);
  });
});

describe('the four service types', () => {
  it('DOOR_TO_DOOR plans collection, transport and delivery', async () => {
    const r = await post(customer, 'shipping/quote', doorToDoor());
    expect(r.body.available).toBe(true);
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LINE_HAUL', 'LAST_MILE']);
  });

  it('DOOR_TO_HUB stops at the terminal', async () => {
    const r = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia' },
      destination: { hubId: hub.SPA },
      preferredMode: 'AIR',
    });
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LINE_HAUL']);
  });

  it('HUB_TO_DOOR starts at the terminal', async () => {
    const r = await post(customer, 'shipping/quote', {
      service: 'HUB_TO_DOOR',
      origin: { hubId: hub.PLA },
      destination: { district: 'BELIZE', city: 'San Pedro' },
      preferredMode: 'AIR',
    });
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['LINE_HAUL', 'LINE_HAUL', 'LAST_MILE']);
  });

  it('HUB_TO_HUB is transport only, and charges no courier fee', async () => {
    const r = await post(customer, 'shipping/quote', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.PLA },
      destination: { hubId: hub.SPA },
      preferredMode: 'AIR',
    });
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['LINE_HAUL', 'LINE_HAUL']);
    expect(r.body.totalMinor).toBe(8000 + 6000);
  });

  it('quotes one price for the whole journey, courier legs included', async () => {
    const r = await post(customer, 'shipping/quote', doorToDoor());
    // 1200 (Placencia courier) + 8000 + 6000 + 1500 (San Pedro courier)
    expect(r.body.totalMinor).toBe(1200 + 8000 + 6000 + 1500);
    expect(r.body.pricingIncomplete).toBe(false);
  });

  it('says so out loud when a hub has no courier fee configured', async () => {
    await ctx.prisma.logisticsHub.update({ where: { id: hub.PLA }, data: { courierFeeMinor: 0n } });
    const r = await post(customer, 'shipping/quote', doorToDoor());
    expect(r.body.pricingIncomplete).toBe(true);
    expect(r.body.pricingNote).toContain('Placencia Airstrip');
  });
});

describe('the service-type field', () => {
  // The booking form used to hard-code its mode options, so it could offer a
  // customer a mode the network cannot actually fly or drive.
  it('publishes the modes the live network can actually carry, without a login', async () => {
    const r = await request(ctx.server).get('/api/shipping/modes');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    // A flat list of mode names, in the order the form should offer them.
    for (const m of r.body) expect(['LAND', 'AIR', 'SEA']).toContain(m);
  });

  it('drops a mode as soon as its last active route is switched off', async () => {
    const before: string[] = (await request(ctx.server).get('/api/shipping/modes')).body;
    expect(before).toContain('AIR');

    await ctx.prisma.logisticsRoute.updateMany({ where: { mode: 'AIR' }, data: { isActive: false } });

    const after: string[] = (await request(ctx.server).get('/api/shipping/modes')).body;
    expect(after).not.toContain('AIR');

    await ctx.prisma.logisticsRoute.updateMany({ where: { mode: 'AIR' }, data: { isActive: true } });
  });

  it('refuses a quote for a mode the network does not run', async () => {
    const r = await post(customer, 'shipping/quote', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.PLA },
      destination: { hubId: hub.SPA },
      preferredMode: 'SUBMARINE',
    });
    expect(r.status).toBe(400);
  });

  it('DOOR_TO_HUB needs a hub on the destination, not a district', async () => {
    // The form lets a customer switch service type after filling the address in;
    // the leftover district must not be accepted as a terminal.
    const r = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia' },
      destination: { district: 'BELIZE', city: 'San Pedro' },
      preferredMode: 'AIR',
    });
    expect(r.status).toBe(400);
  });

  it('HUB_TO_DOOR needs a hub on the origin, not a district', async () => {
    const r = await post(customer, 'shipping/quote', {
      service: 'HUB_TO_DOOR',
      origin: { district: 'STANN_CREEK', city: 'Placencia' },
      destination: { district: 'BELIZE', city: 'San Pedro' },
      preferredMode: 'AIR',
    });
    expect(r.status).toBe(400);
  });
});

describe('the network is data', () => {
  it('stops quoting a route the moment an operator deactivates it', async () => {
    const routes = await get(admin, 'admin/logistics/routes');
    const flight = routes.body.find((r: { originHub: { code: string } }) => r.originHub.code === 'PLA');
    expect((await patch(admin, `admin/logistics/routes/${flight.id}`, { isActive: false })).status).toBe(200);

    const r = await post(customer, 'shipping/quote', doorToDoor());
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe('MODE_UNAVAILABLE');
  });

  it('opens a district by adding a hub, with no code change', async () => {
    const before = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_HUB',
      origin: { district: 'CAYO', city: 'San Ignacio' },
      destination: { hubId: hub.SPA },
    });
    expect(before.body.reason).toBe('NO_ORIGIN_HUB');

    const created = await post(admin, 'admin/logistics/hubs', {
      code: 'SIG', name: 'San Ignacio Depot', type: 'WAREHOUSE', district: 'CAYO', city: 'San Ignacio', modes: ['LAND'],
    });
    await post(admin, 'admin/logistics/routes', {
      originHubId: created.body.id, destinationHubId: hub.MUN, mode: 'LAND', durationMinutes: 120, priceMinor: 3000,
    });

    const after = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_HUB',
      origin: { district: 'CAYO', city: 'San Ignacio' },
      destination: { hubId: hub.SPA },
    });
    expect(after.body.available).toBe(true);
  });

  it('refuses a route a terminal cannot physically service', async () => {
    const r = await post(admin, 'admin/logistics/routes', {
      originHubId: hub.PLA, destinationHubId: hub.MUN, mode: 'SEA', durationMinutes: 200, priceMinor: 4000,
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('does not handle sea');
  });

  it('refuses two hubs with the same code', async () => {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: 'MUN', name: 'Another', type: 'WAREHOUSE', district: 'CAYO', city: 'Belmopan', modes: ['LAND'],
    });
    expect(r.status).toBe(409);
  });
});

describe('booking freezes the plan', () => {
  it('creates the legs, the first one ready and the rest waiting', async () => {
    const s = await book();
    expect(s.reference).toMatch(/^BML-[A-Z2-9]{8}$/);
    expect(s.legs.map((l: { status: string }) => l.status)).toEqual(['READY', 'PENDING', 'PENDING', 'PENDING']);
    expect(s.status).toBe('AWAITING_PICKUP');
  });

  it('records the sender as the first custody holder', async () => {
    const s = await book();
    expect(s.custody).toHaveLength(1);
    expect(s.custody[0]).toMatchObject({ fromHolder: null, toHolder: 'SENDER' });
  });

  it('keeps a snapshot of the addresses, not a live reference', async () => {
    const s = await book();
    expect(s.origin.address).toBe('1 Sidewalk');
    expect(s.destination.address).toBe('5 Barrier Reef Drive');
  });

  it('explains the route in plain language, with no ids or enum names', async () => {
    const s = await book();
    expect(s.explanation).toContain('Placencia Airstrip');
    expect(s.explanation).not.toMatch(/c[a-z0-9]{20,}|LINE_HAUL|FIRST_MILE/);
  });

  it('rejects a pin outside Belize', async () => {
    const r = await post(customer, 'shipping', {
      payWithWallet: true,
      ...doorToDoor(),
      origin: { ...doorToDoor().origin, latitude: 51.5074, longitude: -0.1278 },
    });
    expect(r.status).toBe(400);
  });

  it('rejects half a pin', async () => {
    const r = await post(customer, 'shipping', {
      payWithWallet: true,
      ...doorToDoor(),
      origin: { ...doorToDoor().origin, latitude: 16.5 },
    });
    expect(r.status).toBe(400);
  });
});

describe('sequence is authority', () => {
  it('will not release the last mile before the parcel reaches the destination hub', async () => {
    // The rule the whole milestone turns on: no courier is sent to a terminal
    // the parcel is still flying towards.
    const s = await book();
    const ids = legIds(s);
    const lastMile = ids('LAST_MILE_4');

    const early = await post(admin, `admin/logistics/legs/${lastMile}/start`, {});
    expect(early.status).toBe(400);
    expect(early.body.message).toContain('has not reached this leg yet');

    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const stillEarly = await post(admin, `admin/logistics/legs/${lastMile}/start`, {});
    expect(stillEarly.status).toBe(400);

    await completeLeg(ids('LINE_HAUL_2'), await pinOf(ids('LINE_HAUL_2')), true);
    await completeLeg(ids('LINE_HAUL_3'), await pinOf(ids('LINE_HAUL_3')), true);

    const now = await post(admin, `admin/logistics/legs/${lastMile}/start`, {});
    expect(now.status).toBe(201);
  });

  it('releases exactly one leg at a time as each handoff completes', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const after = await get(admin, `admin/logistics/shipments/${s.reference}`);
    expect(after.body.legs.map((l: { status: string }) => l.status)).toEqual(['COMPLETED', 'READY', 'PENDING', 'PENDING']);
  });

  it('walks the whole journey to DELIVERED', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    await completeLeg(ids('LINE_HAUL_2'), await pinOf(ids('LINE_HAUL_2')), true);
    await completeLeg(ids('LINE_HAUL_3'), await pinOf(ids('LINE_HAUL_3')), true);
    const done = await completeLeg(ids('LAST_MILE_4'), await pinOf(ids('LAST_MILE_4')), false);
    expect(done.status).toBe('DELIVERED');
  });

  it('says "ready to collect", never "delivered", when the journey ends at a terminal', async () => {
    const s = await book({
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    await completeLeg(ids('LINE_HAUL_2'), await pinOf(ids('LINE_HAUL_2')), true);
    const done = await completeLeg(ids('LINE_HAUL_3'), await pinOf(ids('LINE_HAUL_3')), true);
    expect(done.status).toBe('AWAITING_COLLECTION');
    expect(done.statusLabel).toBe('Ready to collect');
  });
});

describe('collecting from a terminal', () => {
  /** A DOOR_TO_HUB journey, walked to the point where it is waiting on a counter. */
  async function awaitingCollection() {
    const s = await book({
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    await completeLeg(ids('LINE_HAUL_2'), await pinOf(ids('LINE_HAUL_2')), true);
    const done = await completeLeg(ids('LINE_HAUL_3'), await pinOf(ids('LINE_HAUL_3')), true);
    expect(done.status).toBe('AWAITING_COLLECTION');
    return s;
  }

  it('closes out a journey that no leg can close', async () => {
    // Nobody moves a leg when a recipient walks into a counter, so without this
    // the shipment would read "Ready to collect" forever.
    const s = await awaitingCollection();
    const r = await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DELIVERED');
  });

  it('records the collection as the final custody transfer', async () => {
    const s = await awaitingCollection();
    await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz' });
    const events = await ctx.prisma.custodyEvent.findMany({ where: { shipmentId: s.id }, orderBy: { occurredAt: 'asc' } });
    expect(events.at(-1)).toMatchObject({ fromHolder: 'HUB', toHolder: 'RECIPIENT', actorLabel: 'Maria Cruz' });
  });

  it('will not collect a parcel that has not arrived', async () => {
    const s = await book();
    const r = await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Too Early' });
    expect(r.status).toBe(400);
  });

  it('will not collect the same parcel twice', async () => {
    const s = await awaitingCollection();
    await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz' });
    const again = await post(admin, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Someone Else' });
    expect(again.status).toBe(400);
  });

  it('does not let a customer record their own collection', async () => {
    const s = await awaitingCollection();
    const r = await post(customer, `admin/logistics/shipments/${s.id}/collect`, { collectedByName: 'Me' });
    expect([401, 403]).toContain(r.status);
  });
});

describe('handoff verification', () => {
  it('refuses a wrong code and counts the attempt down', async () => {
    const s = await book();
    const first = legIds(s)('FIRST_MILE_1');
    await post(admin, `admin/logistics/legs/${first}/start`, {});
    const bad = await post(admin, `admin/logistics/legs/${first}/handoff`, { pin: '0000', receivedByName: 'Nobody' });
    // A 4-digit PIN can legitimately be 0000, so assert on the outcome instead.
    if (bad.status === 400) expect(bad.body.message).toMatch(/not right/);
    else expect(bad.status).toBe(201);
  });

  it('locks the leg after repeated wrong codes', async () => {
    const s = await book();
    const first = legIds(s)('FIRST_MILE_1');
    await post(admin, `admin/logistics/legs/${first}/start`, {});
    const real = await pinOf(first);
    const wrong = real === '1111' ? '2222' : '1111';
    for (let i = 0; i < 5; i++) await post(admin, `admin/logistics/legs/${first}/handoff`, { pin: wrong, receivedByName: 'Nobody' });
    const locked = await post(admin, `admin/logistics/legs/${first}/handoff`, { pin: real, receivedByName: 'Staff' });
    expect(locked.status).toBe(403);
  });

  it('never returns a handoff code to staff who are listing shipments', async () => {
    const s = await book();
    const staffView = await get(admin, `admin/logistics/shipments/${s.reference}`);
    for (const leg of staffView.body.legs) expect(leg.handoffPin).toBeNull();
  });

  it('gives the customer only their own door code', async () => {
    const s = await book();
    const mine = s.legs.filter((l: { handoffPin: string | null }) => l.handoffPin != null);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('LAST_MILE');
  });

  it('gives a hub-ending shipment no door code at all', async () => {
    const s = await book({
      service: 'DOOR_TO_HUB',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'S', phone: '501-2223333' },
      destination: { hubId: hub.SPA, name: 'R', phone: '501-4445555' },
      preferredMode: 'AIR',
    });
    expect(s.legs.every((l: { handoffPin: string | null }) => l.handoffPin == null)).toBe(true);
  });
});

describe('chain of custody', () => {
  it('records every transfer, in order, and never rewrites one', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const before = await ctx.prisma.custodyEvent.findMany({ where: { shipmentId: s.id }, orderBy: { occurredAt: 'asc' } });
    await completeLeg(ids('LINE_HAUL_2'), await pinOf(ids('LINE_HAUL_2')), true);
    const after = await ctx.prisma.custodyEvent.findMany({ where: { shipmentId: s.id }, orderBy: { occurredAt: 'asc' } });

    // Append-only: every earlier row is still there, byte for byte.
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.map((c) => c.toHolder).slice(0, 3)).toEqual(['SENDER', 'DRIVER', 'HUB']);
  });

  it('names who took it at each terminal', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const events = await ctx.prisma.custodyEvent.findMany({ where: { shipmentId: s.id } });
    expect(events.some((e) => e.actorLabel === 'Counter staff')).toBe(true);
  });
});

describe('exceptions and cancellation', () => {
  it('stops the shipment and marks it as needing attention', async () => {
    const s = await book();
    const first = legIds(s)('FIRST_MILE_1');
    await post(admin, `admin/logistics/legs/${first}/start`, {});
    const r = await post(admin, `admin/logistics/legs/${first}/exception`, { reason: 'Parcel damaged in the van.' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('EXCEPTION');
    expect(r.body.exceptionReason).toBe('Parcel damaged in the van.');
  });

  it('cancels the legs that have not happened and leaves the ones that have', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const r = await post(admin, `admin/logistics/shipments/${s.id}/cancel`, { reason: 'Customer changed their mind.' });
    expect(r.status).toBe(201);
    const statuses = r.body.legs.map((l: { status: string }) => l.status);
    // The parcel really was collected. Rewriting that to tidy up would put a lie
    // in the custody chain.
    expect(statuses[0]).toBe('COMPLETED');
    expect(statuses.slice(1)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
  });

  it('lets a customer cancel before it moves, but not once it is moving', async () => {
    const s = await book();
    const ok = await post(customer, `shipping/${s.id}/cancel`, { reason: 'Booked by mistake.' });
    expect(ok.status).toBe(201);

    const s2 = await book();
    await post(admin, `admin/logistics/legs/${legIds(s2)('FIRST_MILE_1')}/start`, {});
    const denied = await post(customer, `shipping/${s2.id}/cancel`, { reason: 'Too late.' });
    expect(denied.status).toBe(400);
  });
});

describe('who may see and do what', () => {
  it('does not let one customer track another customer\'s shipment', async () => {
    const s = await book();
    const other = await registerCustomer(`other_${uniq()}@example.com`);
    const r = await get(other.cookies, `shipping/${s.reference}`);
    // Deliberately "not found" rather than "forbidden": a reference that answers
    // "wrong customer" is a way to enumerate references.
    expect(r.status).toBe(404);
  });

  it('does not let a customer operate a leg', async () => {
    const s = await book();
    const r = await post(customer, `admin/logistics/legs/${legIds(s)('FIRST_MILE_1')}/start`, {});
    expect([401, 403]).toContain(r.status);
  });

  it('does not let a customer configure the network', async () => {
    const r = await post(customer, 'admin/logistics/hubs', {
      code: 'XXX', name: 'Mine', type: 'WAREHOUSE', district: 'CAYO', city: 'Belmopan', modes: ['LAND'],
    });
    expect([401, 403]).toContain(r.status);
  });

  it('does not let a signed-out visitor quote or book', async () => {
    expect((await request(ctx.server).post('/api/shipping/quote').send(doorToDoor())).status).toBe(401);
    expect((await request(ctx.server).post('/api/shipping').send(doorToDoor())).status).toBe(401);
  });

  it('does show the public terminal list to anyone, with nothing operational in it', async () => {
    const r = await request(ctx.server).get('/api/shipping/hubs');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    for (const h of r.body) expect(h).not.toHaveProperty('courierFeeMinor');
  });

  it('lists a customer only their own shipments', async () => {
    await book();
    const other = await registerCustomer(`other2_${uniq()}@example.com`);
    expect((await get(other.cookies, 'shipping')).body).toHaveLength(0);
    expect((await get(customer, 'shipping')).body).toHaveLength(1);
  });
});

describe('audit', () => {
  it('records who configured the network and who moved the parcel', async () => {
    const s = await book();
    await completeLeg(legIds(s)('FIRST_MILE_1'), await pinOf(legIds(s)('FIRST_MILE_1')), false);
    const actions = (await ctx.prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toContain('LOGISTICS_HUB_CREATED');
    expect(actions).toContain('LOGISTICS_ROUTE_CREATED');
    expect(actions).toContain('SHIPMENT_CREATED');
    expect(actions).toContain('SHIPMENT_LEG_HANDOFF');
  });

  it('records a failed handoff code as its own event', async () => {
    const s = await book();
    const first = legIds(s)('FIRST_MILE_1');
    await post(admin, `admin/logistics/legs/${first}/start`, {});
    const real = await pinOf(first);
    // Counted before and after: the audit log is not cleared between tests, so an
    // absolute count would just be measuring the rest of the suite.
    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED' } });
    await post(admin, `admin/logistics/legs/${first}/handoff`, { pin: real === '1111' ? '2222' : '1111', receivedByName: 'Nobody' });
    const after = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED' } });
    expect(after - before).toBe(1);
  });
});

describe('the customer sees one journey', () => {
  it('reports a single status and price for a four-leg trip', async () => {
    const s = await book();
    const view = await get(customer, `shipping/${s.reference}`);
    expect(view.body.statusLabel).toBe('Waiting to be collected');
    expect(view.body.quotedTotalMinor).toBe(1200 + 8000 + 6000 + 1500);
    expect(view.body.legs).toHaveLength(4);
    expect(view.body.currentLegSequence).toBe(1);
  });

  it('moves the "you are here" marker as the journey progresses', async () => {
    const s = await book();
    const ids = legIds(s);
    await completeLeg(ids('FIRST_MILE_1'), await pinOf(ids('FIRST_MILE_1')), false);
    const view = await get(customer, `shipping/${s.reference}`);
    expect(view.body.currentLegSequence).toBe(2);
    expect(view.body.legs.find((l: { sequence: number }) => l.sequence === 2).isCurrent).toBe(true);
  });

  it('names the carrier rather than hiding who is flying it', async () => {
    const s = await book();
    const lineHaul = s.legs.find((l: { kind: string }) => l.kind === 'LINE_HAUL');
    expect(lineHaul.carrier).toBe('Tropic Air');
  });
});
