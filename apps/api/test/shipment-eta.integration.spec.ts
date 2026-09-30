/**
 * BMPL-340: a multi-leg shipment ETA on the tracking responses, derived from
 * real configured data loaded through Prisma — the pure math itself is
 * exhaustively covered by packages/shared/src/shipment-eta.test.ts; this file
 * proves the WIRING (LogisticsNetworkService.hubHoursConfig's real DB load,
 * the leg/window field mapping, and the customer/staff/recipient response
 * shapes) rather than re-testing the algorithm.
 *
 * Reuses shipment-hub-hours-dispatch.integration.spec.ts's own fixtures
 * (seedNetwork, bookUndispatched, setHubHours) — same network, same booking
 * shape, so this file trusts that one's own coverage of the dispatch side
 * and only adds what is new here: the ETA field on the tracking payloads.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let hub: Record<string, string>;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'BMPL-340 test fixture.' });
  return { cookies, userId };
}

async function seedNetwork() {
  const hubs = [
    { code: 'PHE', name: 'Placencia Airstrip (eta test)', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
    { code: 'SPE', name: 'San Pedro Airstrip (eta test)', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: `${h.code}${uniq()}`.slice(0, 12), name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  expect((await post(admin, 'admin/logistics/routes', { originHubId: hub.PHE, destinationHubId: hub.SPE, mode: 'AIR', durationMinutes: 20, priceMinor: 6000, carrierName: 'Tropic Air' })).status).toBe(201);
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  const firstMile = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id, kind: 'FIRST_MILE' } });
  return { reference: r.body.reference as string, shipmentId: r.body.id as string, firstMileId: firstMile.id as string, recipientToken: r.body.recipientTrackingToken as string };
}

async function setHubHours(hubId: string, openTime: string, closeTime: string) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime, closeTime }));
  expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days })).status).toBe(200);
}

async function closeHubEveryDay(hubId: string) {
  // openTime/closeTime are OPTIONAL in the schema, not nullable — omit the
  // keys entirely for a closed day rather than sending an explicit null,
  // which Zod's `.optional()` (no `.nullable()`) refuses.
  const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: true }));
  expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days })).status).toBe(200);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await seedNetwork();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  const hubIds = Object.values(hub);
  await ctx.prisma.hubHoursException.deleteMany({ where: { hubId: { in: hubIds } } });
  await ctx.prisma.hubOpeningDay.deleteMany({ where: { hubId: { in: hubIds } } });
});

describe('shipment ETA on the tracking payloads (BMPL-340)', () => {
  // This network needs a LINE_HAUL hop (Placencia -> San Pedro, different
  // districts) between the FIRST_MILE and LAST_MILE legs. A LINE_HAUL leg's
  // own ETA is UNKNOWN unless an operator has recorded a real
  // scheduledDepartureAt/scheduledArrivalAt commitment for it — and nothing
  // anywhere in this API writes those fields yet (a found, reported gap,
  // not a defect in this card: the honest answer for an unconfirmed
  // carrier booking really is "unknown", not a guessed transit time). So
  // the OVERALL shipment confidence on every booking in this file is
  // UNKNOWN by construction, regardless of what the FIRST_MILE hub-hours
  // checks below prove — these assertions target the FIRST_MILE leg's OWN
  // confidence, which the LINE_HAUL gap does not touch.

  it('an unconfigured hub projects a real arrival for FIRST_MILE, not UNKNOWN — the same "absence means unconstrained" default as dispatch', async () => {
    const sender = await fundedSender();
    const { reference } = await book(sender.cookies);

    const res = await get(sender.cookies, `shipping/${reference}`);
    expect(res.status).toBe(200);
    const firstMileLeg = res.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(firstMileLeg.eta.confidence).toBe('PROJECTED');
    expect(firstMileLeg.eta.estimatedCompletionAt).not.toBeNull();
    // A sane window: the server's own "now" is captured a few ms before
    // this assertion's own Date.now() read, and this leg's configured
    // duration may be zero in this test network — so a few ms of slack on
    // the lower bound, and a generous few hours on the upper one.
    const arrivalMs = new Date(firstMileLeg.eta.estimatedCompletionAt).getTime();
    expect(arrivalMs).toBeGreaterThan(Date.now() - 5000);
    expect(arrivalMs).toBeLessThan(Date.now() + 6 * 3600 * 1000);

    // The overall shipment confidence is UNKNOWN regardless — see this
    // describe block's own header comment (the LINE_HAUL gap).
    expect(res.body.eta.confidence).toBe('UNKNOWN');
  });

  it('a destination hub configured CLOSED EVERY DAY (time-independent — never opens, whenever the test runs) makes the FIRST_MILE leg UNKNOWN', async () => {
    await closeHubEveryDay(hub.PHE!);
    const sender = await fundedSender();
    const { reference } = await book(sender.cookies);

    const res = await get(sender.cookies, `shipping/${reference}`);
    expect(res.status).toBe(200);
    expect(res.body.eta.confidence).toBe('UNKNOWN');
    expect(res.body.eta.estimatedArrivalAt).toBeNull();
    const firstMileLeg = res.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(firstMileLeg.eta.confidence).toBe('UNKNOWN');
    expect(firstMileLeg.eta.reason).toMatch(/no configured opening window/);
  });

  it('a hub with hours configured wide open resolves PROJECTED for FIRST_MILE like the unconfigured case — configuring generous hours changes nothing', async () => {
    await setHubHours(hub.PHE!, '00:00', '23:59');
    const sender = await fundedSender();
    const { reference } = await book(sender.cookies);
    const res = await get(sender.cookies, `shipping/${reference}`);
    const firstMileLeg = res.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(firstMileLeg.eta.confidence).toBe('PROJECTED');
  });

  it('the public recipient view carries the SAME eta summary as the customer view, with no per-leg detail', async () => {
    const sender = await fundedSender();
    await closeHubEveryDay(hub.PHE!);
    const { reference, recipientToken } = await book(sender.cookies);

    const staffAndCustomerView = await get(sender.cookies, `shipping/${reference}`);
    expect(staffAndCustomerView.body.eta.confidence).toBe('UNKNOWN');

    const publicView = await request(ctx.server).get(`/api/shipping/track/${recipientToken}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.eta).toEqual({ confidence: 'UNKNOWN', estimatedArrivalAt: null });
    // The privacy allowlist is unchanged: no leg-level reason, no hub id.
    expect(publicView.body.steps[0]).not.toHaveProperty('eta');
  });

  it('a COMPLETED leg reports KNOWN with its own real completedAt — no projection once it already happened', async () => {
    const sender = await fundedSender();
    const { reference, firstMileId } = await book(sender.cookies);
    const completedAt = new Date();
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMileId }, data: { status: 'COMPLETED', completedAt, startedAt: new Date(completedAt.getTime() - 60_000) } });

    const res = await get(sender.cookies, `shipping/${reference}`);
    const firstMileLeg = res.body.legs.find((l: { kind: string }) => l.kind === 'FIRST_MILE');
    expect(firstMileLeg.eta).toMatchObject({ confidence: 'KNOWN' });
    expect(new Date(firstMileLeg.eta.estimatedCompletionAt).getTime()).toBe(completedAt.getTime());
  });
});
