/**
 * BMPL-196: a configured route schedule (BMPL-186) governs whether the route
 * can actually be used, against real Postgres.
 *
 * BMPL-186 shipped the whole capability to configure whether a route runs on
 * a given date and NOTHING READ IT: route-planner.ts filtered only on
 * isActive, and no dispatch or shipment path ever consulted
 * resolveScheduleStatus. A carrier could mark a route NOT_OPERATING and the
 * system would still plan, quote and dispatch shipments over it. This suite
 * pins the fix at both the points it was wired into:
 *
 *   1. ROUTE PLANNING - quoting and booking (ShipmentService.quote/create,
 *      via the shared planRoute) exclude a route resolving NOT_OPERATING for
 *      today.
 *   2. DISPATCH ELIGIBILITY - confirming a line-haul departure
 *      (ShipmentService.departLeg, the one method both the staff desk and a
 *      carrier's own surface call) refuses when the route resolves
 *      NOT_OPERATING for today.
 *
 * THE LOAD-BEARING CASE, proven first and re-proven throughout: every real
 * route in production has ZERO schedule configuration, and an unconfigured
 * route MUST keep planning, booking and departing exactly as it does today.
 * `resolveScheduleStatus` defaults an unconfigured day and an unconfigured
 * date to OPERATING - this suite never assumes that, it tests it directly.
 *
 * No real schedule data appears anywhere in this file - every day, date and
 * reason below is a synthetic fixture, matching the convention already in
 * route-schedule.integration.spec.ts, never a real BML carrier's timetable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

/**
 * Belize is a fixed UTC-6 with no daylight saving, and `resolveScheduleStatus`
 * (packages/shared/src/service-schedule.ts) resolves "today" against Belize
 * local time, not UTC (BMPL-196). These mirror that same fixed-offset
 * conversion so the fixtures agree with the resolver about what day it is -
 * before the fix, both this file and the resolver used a plain UTC read, so
 * the two were internally consistent but wrong for six hours of every
 * Belize evening, and nothing ever reddened.
 */
const BELIZE_OFFSET_MS = -6 * 60 * 60 * 1000;
/** Today's calendar date as the resolver sees it - Belize local year-month-day. */
const isoToday = () => new Date(Date.now() + BELIZE_OFFSET_MS).toISOString().slice(0, 10);
/** Today's weekday, 0=Sunday..6=Saturday, in Belize local time, matching the weekly-pattern column. */
const todayWeekday = () => new Date(Date.now() + BELIZE_OFFSET_MS).getUTCDay();

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Two synthetic terminals and the one AIR route between them - a single-hop HUB_TO_HUB network. */
async function seedRoute() {
  const suffix = uniq();
  const o = await post(admin, 'admin/logistics/hubs', {
    code: `WO${suffix}`.slice(0, 12), name: `Synthetic Wiring Origin ${suffix}`, type: 'AIRSTRIP',
    district: 'BELIZE', city: 'Synthetic Wiring Origin Town', modes: ['LAND', 'AIR'], courierFeeMinor: 500,
  });
  expect(o.status).toBe(201);
  const d = await post(admin, 'admin/logistics/hubs', {
    code: `WD${suffix}`.slice(0, 12), name: `Synthetic Wiring Destination ${suffix}`, type: 'AIRSTRIP',
    district: 'STANN_CREEK', city: 'Synthetic Wiring Destination Town', modes: ['LAND', 'AIR'], courierFeeMinor: 500,
  });
  expect(d.status).toBe(201);
  const r = await post(admin, 'admin/logistics/routes', {
    originHubId: o.body.id, destinationHubId: d.body.id, mode: 'AIR',
    durationMinutes: 30, priceMinor: 4000, carrierName: 'Synthetic Test Carrier',
  });
  expect(r.status).toBe(201);
  return { routeId: r.body.id as string, originHubId: o.body.id as string, destinationHubId: d.body.id as string };
}

const quoteHubToHub = (originHubId: string, destinationHubId: string) => ({
  service: 'HUB_TO_HUB',
  origin: { hubId: originHubId },
  // Booking (not quoting) unconditionally requires a name and phone for
  // whoever is receiving the parcel, even on a HUB_TO_HUB journey where
  // nobody is knocking on a door - see createShipmentSchema.
  destination: { hubId: destinationHubId, name: 'Recipient', phone: '501-4445555' },
});

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
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.routeScheduleException.deleteMany();
  await ctx.prisma.routeOperatingDay.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
});

describe('route planning consults the schedule', () => {
  it('an unconfigured route - the state of every real route today - still quotes and books', async () => {
    const { originHubId, destinationHubId } = await seedRoute();
    const customer = await registerCustomer(`wire_${uniq()}@example.com`);
    const q = await post(customer.cookies, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId));
    expect(q.status).toBe(201);
    expect(q.body.available).toBe(true);

    // The test's own name claims "and books" — prove it, not just quote
    // availability. A quote flag flipping true is not proof a real booking
    // and a real LINE_HAUL leg follow from it.
    await post(admin, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 100_000, reason: 'Schedule-wiring test fixture.' });
    const book = await post(customer.cookies, 'shipping', { ...quoteHubToHub(originHubId, destinationHubId), payWithWallet: true });
    expect(book.status).toBe(201);
    expect(book.body.legs).toHaveLength(1);
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: book.body.legs[0].id } });
    expect(leg.kind).toBe('LINE_HAUL');
    expect(leg.status).toBe('READY');
  });

  it('a route marked NOT_OPERATING for today, via a date exception, is not offered', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'NOT_OPERATING', reason: 'Synthetic test closure - not a real BML closure',
    });
    const customer = (await registerCustomer(`wire_${uniq()}@example.com`)).cookies;
    const q = await post(customer, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId));
    expect(q.status).toBe(201);
    expect(q.body.available).toBe(false);

    // Booking must refuse too, not just the quote preview.
    const book = await post(customer, 'shipping', { ...quoteHubToHub(originHubId, destinationHubId), payWithWallet: true });
    expect(book.status).toBe(400);
  });

  it('a route marked NOT_OPERATING for today via the WEEKLY pattern is also excluded', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const weeklySet = await put(admin, `admin/logistics/routes/${routeId}/schedule`, {
      days: [{ dayOfWeek: todayWeekday(), status: 'NOT_OPERATING' }],
    });
    expect(weeklySet.status).toBe(200);
    const customer = (await registerCustomer(`wire_${uniq()}@example.com`)).cookies;
    const q = await post(customer, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId));
    expect(q.body.available).toBe(false);
  });

  it('a REDUCED day still quotes - operations said thinner, not stopped', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'REDUCED', reason: 'Synthetic test note - one vessel only',
    });
    const customer = (await registerCustomer(`wire_${uniq()}@example.com`)).cookies;
    const q = await post(customer, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId));
    expect(q.body.available).toBe(true);
  });

  it('removing the exception restores the route to plannable, same day', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const added = await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'NOT_OPERATING',
    });
    const customer = (await registerCustomer(`wire_${uniq()}@example.com`)).cookies;
    expect((await post(customer, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId))).body.available).toBe(false);

    expect((await del(admin, `admin/logistics/routes/${routeId}/schedule/exceptions/${added.body.id}`)).status).toBe(200);
    expect((await post(customer, 'shipping/quote', quoteHubToHub(originHubId, destinationHubId))).body.available).toBe(true);
  });
});

describe('departing a line-haul leg consults the schedule', () => {
  /** Book a single-hop HUB_TO_HUB shipment; its only leg is a LINE_HAUL, READY immediately. */
  async function bookAndFundedCustomer(originHubId: string, destinationHubId: string) {
    const c = await registerCustomer(`wire_${uniq()}@example.com`);
    const credit = await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Schedule-wiring test fixture.' });
    expect(credit.status).toBe(201);
    const book = await post(c.cookies, 'shipping', { ...quoteHubToHub(originHubId, destinationHubId), payWithWallet: true });
    expect(book.status).toBe(201);
    expect(book.body.legs).toHaveLength(1);
    expect(book.body.legs[0].kind).toBe('LINE_HAUL');
    expect(book.body.legs[0].status).toBe('READY');
    return { cookies: c.cookies, legId: book.body.legs[0].id as string };
  }

  it('departs normally when the route has no schedule configured at all', async () => {
    const { originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    const departed = await post(admin, `admin/logistics/legs/${legId}/depart`, {});
    expect(departed.status).toBe(201);

    // THE LOAD-BEARING CASE, checked as state, not just an HTTP code (BMPL-140
    // fresh-audit standard): a 201 alone would not distinguish a leg that
    // genuinely departed from one where an unrelated regression short-circuits
    // to a success response before the actual write. Every real route in
    // production is unconfigured, so this is the path that must never be
    // wrong.
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('IN_PROGRESS');
    expect(leg.departedAt).not.toBeNull();
    const custody = await ctx.prisma.custodyEvent.findFirst({
      where: { shipmentLegId: legId, toHolder: 'CARRIER' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(custody).not.toBeNull();
    expect(custody!.fromHolder).toBe('HUB');
  });

  it('refuses to depart a leg on a route marked NOT_OPERATING for today', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    // The exception is added AFTER booking, matching real timing: a route can
    // be fine when a customer books and closed by the time the carrier is
    // ready to actually leave the terminal.
    await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'NOT_OPERATING', reason: 'Synthetic test closure',
    });
    const departed = await post(admin, `admin/logistics/legs/${legId}/depart`, {});
    expect(departed.status).toBe(400);
    expect(departed.body.message).toMatch(/not operating today/i);

    // The leg is untouched - still READY, not silently advanced.
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('READY');
    expect(leg.departedAt).toBeNull();
  });

  it('departs on a REDUCED day', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'REDUCED', reason: 'Synthetic test note',
    });
    const departed = await post(admin, `admin/logistics/legs/${legId}/depart`, {});
    expect(departed.status).toBe(201);
  });

  it('departs once the blocking exception is removed', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    const added = await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'NOT_OPERATING',
    });
    expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(400);
    expect((await del(admin, `admin/logistics/routes/${routeId}/schedule/exceptions/${added.body.id}`)).status).toBe(200);
    expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  });

  it('a closed route cannot be bypassed via /start - the sibling endpoint an adversarial review found (BMPL-196)', async () => {
    const { routeId, originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    await post(admin, `admin/logistics/routes/${routeId}/schedule/exceptions`, {
      date: isoToday(), status: 'NOT_OPERATING', reason: 'Synthetic test closure',
    });

    const departed = await post(admin, `admin/logistics/legs/${legId}/depart`, {});
    expect(departed.status).toBe(400);

    // Before the fix, /start had no leg.kind check and consulted no schedule
    // at all, so this SAME leg could be advanced to IN_PROGRESS through the
    // sibling endpoint even though /depart correctly refused it.
    const started = await post(admin, `admin/logistics/legs/${legId}/start`, {});
    expect(started.status).toBe(400);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('READY');
    expect(leg.startedAt).toBeNull();
  });

  /**
   * ShipmentLeg.routeId is nullable on the column, but the route planner is
   * the ONLY place a LINE_HAUL leg is ever created and it always sets a real
   * routeId — so this state is structurally unreachable through any product
   * path today. The raw write below is the only way to construct it, exactly
   * the same precedent other suites in this codebase use to exercise a
   * defensive branch nothing legitimate can reach (e.g. the S2 review's F5,
   * an isActive=false write no product path can produce).
   *
   * The point being pinned: departLeg must refuse this loudly rather than
   * silently skip its BMPL-196 schedule check, so that a future second
   * leg-creation path that forgets to set routeId fails LOUDLY the moment it
   * tries to depart, instead of departing unchecked with nothing anywhere
   * telling whoever wrote that path they had just disabled enforcement.
   */
  it('a LINE_HAUL leg with no route on record refuses to depart rather than skip its schedule check', async () => {
    const { originHubId, destinationHubId } = await seedRoute();
    const { legId } = await bookAndFundedCustomer(originHubId, destinationHubId);
    await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { routeId: null } });

    const departed = await post(admin, `admin/logistics/legs/${legId}/depart`, {});
    expect(departed.status).toBe(400);
    expect(departed.body.message).toMatch(/no route on record/i);

    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe('READY');
    expect(leg.departedAt).toBeNull();
  });
});
