/**
 * DISPATCH-1/DISPATCH-2 — red tests for a defect found live on the shared
 * dev DB, not reasoned about in the abstract: `sweepUndispatched()`'s own
 * query (shipment-dispatch.service.ts, `waitingLegsWhere()` + `take: 50`,
 * no `orderBy`) and the manual-assign path (`assignManual`, same file) both
 * let a courier leg hold or lose dispatch standing with nothing automatic
 * to release it. See handoff.md "FLOOR-3 / DISPATCH-1" for the live
 * reproduction (`BML-A7YWCFG3`, left untouched in the shared dev DB per
 * god's explicit order) this file re-proves as synthetic, isolated fixtures.
 *
 * All four cases below are independent of isTest — none of the code paths
 * under test branch on it — so a green result here is a production claim,
 * not an isTest one.
 *
 * Round 2 (god's reply on this card, DISPATCH-2): the original version of
 * the first case asserted "every waiting leg gets scanned at least once",
 * which is unmeetable even by a correct fix (`dispatchUnavailableAt` is not
 * a `waitingLegsWhere()` filter, so a leg with nobody online never leaves
 * the waiting set). It is now a FAIRNESS invariant instead (no newer leg
 * scanned while an older one is excluded), which is the property ordering
 * actually delivers and is still red today. A DRAIN case was added
 * alongside it to prove the backlog is not permanently stuck when a driver
 * IS present — that one currently passes, as a regression guard for
 * whatever orderBy/paging fix lands.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let admin: string[];
let dispatch: ShipmentDispatchService;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'DISPATCH-2 starvation fixture' });
  expect(r.status).toBe(201);
}

async function fundedCustomer() {
  const { cookies, userId } = await registerCustomer(`cust_${uniq()}@example.com`);
  await fund(userId, 100_000); // ADMIN_TEST_CREDIT_MAX_MINOR cap
  return { cookies, userId };
}

/** Matches shipment-dispatch-feasibility.integration.spec.ts's own helper. */
async function makeDriver(district: string, opts: { online?: boolean } = {}) {
  const { userId, cookies } = await registerCustomer(`drv_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const s = uniq();
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'On Line', displayName: `Drv${s}`, phone: '+5016000099',
      homeDistrict: district as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: opts.online === false ? 'OFFLINE' : 'ONLINE', isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { driverProfileId: profile.id, vehicleId: vehicle.id, userId, cookies };
}

async function setDispatch(opts: { automatic: boolean; maxConcurrentPerDriver?: number }) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = {
    dispatchAutomatic: opts.automatic,
    dispatchOfferTimeoutSeconds: 90,
    dispatchMaxOffers: 3,
    dispatchMaxConcurrentPerDriver: opts.maxConcurrentPerDriver ?? 3,
  };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** DIRECT leg, door-to-door, both ends in the same district/city. */
async function bookDirect(cookies: string[], district: string, city: string): Promise<string> {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district, city, address: '1 Front St', name: 'S', phone: '501-222-3333' },
    destination: { district, city, address: '2 Front St', name: 'R', phone: '501-444-5555' },
    description: 'Documents',
    pieces: 1,
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await patch(admin, 'admin/ops/settings', { localCourierFeeMinor: 1500, localCourierFeeTestMinor: 1500, localCourierMinutes: 60 });
  dispatch = ctx.app.get(ShipmentDispatchService);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('DISPATCH-2 / fairness: sweepUndispatched has no orderBy, so a newer waiting leg can be scanned while an older one never is', () => {
  // Round 2, per god's ruling on the original version of this test (which
  // asserted "every waiting leg gets scanned at least once"): that spec is
  // UNMEETABLE even by a correct fix, because `dispatchUnavailableAt`
  // (shipment-dispatch.service.ts, set in `recordUnavailableIfNew`) is not a
  // filter in `waitingLegsWhere()` -- a leg with no eligible driver online
  // never leaves the waiting set, so with nothing online in COROZAL here,
  // adding `orderBy: { createdAt: 'asc' }` would still only rotate which 50
  // of the (now permanently waiting) legs are the oldest 50, forever -- the
  // same 50 every tick, exactly as today. "Every leg scanned" is not the
  // right property; scanning a leg where nobody is online achieves nothing.
  //
  // The property ordering actually owes is FAIRNESS: no leg that is left
  // unscanned may be OLDER than a leg that WAS scanned -- no newer leg jumps
  // an older one. That still fails today, because there is no orderBy at all.
  it('never scans a newer leg while leaving an older leg out of the scan entirely, when nothing is online', async () => {
    await setDispatch({ automatic: true, maxConcurrentPerDriver: 3 });
    // COROZAL: seedRoles's baseline courier covers it but is permanently
    // OFFLINE (see helpers.ts), so every booking here is a real,
    // TEMPORARILY_UNAVAILABLE 201 — paid, leg created, courierStatus null,
    // genuinely waiting — with zero chance of an auto-offer landing on
    // booking itself and perturbing the fixture.
    const { cookies } = await fundedCustomer();
    const shipmentIds: string[] = [];
    const legIds: string[] = [];
    // 51, not 55: the minimum that forces take(50) to structurally exclude
    // at least one leg, keeping this test's dominant cost (sequential real
    // bookings) as small as the property needs.
    for (let i = 0; i < 51; i++) {
      const shipmentId = await bookDirect(cookies, 'COROZAL', 'Corozal Town');
      shipmentIds.push(shipmentId);
      const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });
      legIds.push(leg.id);
    }
    try {
      expect(await ctx.prisma.shipmentLeg.count({ where: { id: { in: legIds }, assignedDriverProfileId: null, courierStatus: null } })).toBe(51);

      // Scramble createdAt to the exact reverse of insertion order, same
      // technique as the oldest-first case below, so physical/insertion
      // order and age deliberately disagree. Without this, a coincidental
      // match between the two would hide the defect instead of proving its
      // absence.
      const now = Date.now();
      for (let i = 0; i < legIds.length; i++) {
        const createdAt = new Date(now - i * 24 * 3600 * 1000);
        await ctx.prisma.shipmentLeg.update({ where: { id: legIds[i] }, data: { createdAt } });
      }

      // Nothing online in COROZAL, so nothing about these rows' match
      // against waitingLegsWhere() ever changes between calls -- a real
      // repeated 20s-tick sweep would see the identical unchanged table.
      const spy = vi.spyOn(dispatch, 'dispatchLeg');
      for (let tick = 0; tick < 5; tick++) {
        await dispatch.sweepUndispatched();
      }
      const everScanned = new Set(spy.mock.calls.map((args) => args[0]));
      spy.mockRestore();

      const rows = await ctx.prisma.shipmentLeg.findMany({
        where: { id: { in: legIds } },
        select: { id: true, createdAt: true },
      });
      const scannedAges = rows.filter((r) => everScanned.has(r.id)).map((r) => r.createdAt.getTime());
      const unscannedAges = rows.filter((r) => !everScanned.has(r.id)).map((r) => r.createdAt.getTime());
      // Sanity: take(50) against 51 legs must leave exactly one unscanned,
      // or this invariant has nothing to check.
      expect(unscannedAges.length).toBeGreaterThan(0);

      // THE SPEC: every leg that WAS scanned is older than every leg that was
      // NOT -- no newer leg is ever let through while an older one waits
      // outside the scan. FAILS on current main: with no orderBy, which <=50
      // of the 51 get scanned is governed by physical/insertion order, which
      // we deliberately scrambled against age above.
      expect(Math.max(...scannedAges)).toBeLessThanOrEqual(Math.min(...unscannedAges));
    } finally {
      // Deliberately permanent waiting legs (nothing online ever clears
      // them) -- left in place they would win take(50) over every OTHER
      // test's fixtures for the rest of this file, which is this exact
      // defect biting test isolation. Clean up so the next describe block
      // gets a pool that only contains its own fixtures.
      await ctx.prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
  }, 120_000); // 51 sequential real bookings (one wallet, serialized debits) outruns the 30s default
});

describe('DISPATCH-2 / drain: with a driver present, cycling and declining eventually reaches a leg take(50) excluded from the first scan', () => {
  // NOT a red test, unlike the two cases above — see the comment inline
  // below for why, and god's DISPATCH-2 round-2 ruling for why this is still
  // worth pinning as a regression guard rather than leaving unwritten.
  it('eventually offers a leg beyond the first scan window, once the front of the queue exhausts', async () => {
    await setDispatch({ automatic: true, maxConcurrentPerDriver: 1 });
    // STANN_CREEK: untouched by the other describe blocks in this file, so
    // there is no risk of this test's 51 legs contending with theirs even
    // before each test's own `finally` cleanup runs.
    await makeDriver('STANN_CREEK', { online: true });
    const { cookies } = await fundedCustomer();

    const shipmentIds: string[] = [];
    const legIds: string[] = [];
    for (let i = 0; i < 51; i++) {
      const shipmentId = await bookDirect(cookies, 'STANN_CREEK', 'Dangriga');
      shipmentIds.push(shipmentId);
      const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });
      legIds.push(leg.id);
    }
    try {
      // Which of the 51 never even reach dispatchLeg on the very first tick
      // -- discovered from the spy, not assumed from insertion order, since
      // nothing here orders the underlying query.
      const spy = vi.spyOn(dispatch, 'dispatchLeg');
      await dispatch.sweepUndispatched();
      const firstTickScanned = new Set(spy.mock.calls.map((args) => args[0]));
      spy.mockRestore();
      const beyondFirstWindow = legIds.filter((id) => !firstTickScanned.has(id));
      expect(beyondFirstWindow.length).toBeGreaterThan(0);

      // One online driver, cap 1: whichever leg gets offered holds the
      // driver's only slot until it is declined. Force-expire with FUTURE
      // after every sweep so this drains on its own schedule rather than the
      // offer's real offerTimeoutSeconds -- same technique test 3 uses.
      //
      // THE SPEC (god's ruling, DISPATCH-2 round 2): with a driver present,
      // the backlog is NOT permanently stuck the way it is with nobody
      // online (the fairness case above) -- `rankFor`'s exclusion of a
      // driver already offered THIS leg is what lets `markExhausted` clear
      // a front-of-queue leg out of `waitingLegsWhere()` for good once it has
      // been offered and declined, freeing a take(50) slot for whatever is
      // behind it. This can only pass once that exhaustion mechanism has
      // actually ground through the front of the queue -- not by assumption,
      // by observing `offerCount` on a leg that started beyond the window.
      // That is why this test (unlike the two above) PASSES on current main:
      // the real harm this card found is "a newer leg can jump an older one
      // while a driver sits idle" (the fairness case), not "the backlog
      // never moves when drivers exist." This test exists as a regression
      // guard — whatever orderBy/paging fix lands for the fairness case must
      // not turn this draining behaviour off.
      let reached = false;
      for (let i = 0; i < 150 && !reached; i++) {
        await dispatch.sweepUndispatched();
        await dispatch.sweepExpiredOffers(FUTURE);
        const touched = await ctx.prisma.shipmentLeg.count({
          where: { id: { in: beyondFirstWindow }, offerCount: { gt: 0 } },
        });
        if (touched > 0) reached = true;
      }
      expect(reached).toBe(true);
    } finally {
      await ctx.prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
  }, 240_000);
});

describe('DISPATCH-2 / oldest-first: sweepUndispatched has no orderBy, so it does not actually offer the oldest waiting leg first', () => {
  it('offers a leg that is NOT the oldest by createdAt when physical/insertion order disagrees with age', async () => {
    await setDispatch({ automatic: true, maxConcurrentPerDriver: 1 });
    const { cookies } = await fundedCustomer();

    // 8 legs, booked in this order (so leg #1 is physically earliest in the
    // table, leg #8 physically latest) -- then createdAt is rewritten to the
    // OPPOSITE order, so leg #8 (physically last) is actually the OLDEST by
    // timestamp and leg #1 (physically first) is actually the NEWEST. This
    // deliberately separates "physical/insertion order" from "age" so the
    // test doesn't depend on them coincidentally matching.
    const shipmentIds: string[] = [];
    const legIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const shipmentId = await bookDirect(cookies, 'CAYO', 'San Ignacio');
      shipmentIds.push(shipmentId);
      const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });
      legIds.push(leg.id);
    }
    try {
      const now = Date.now();
      for (let i = 0; i < legIds.length; i++) {
        // legIds[0] (physically first) gets the NEWEST createdAt; the last
        // one gets the OLDEST -- exact reverse of insertion order. (Found
        // while extending this file for DISPATCH-2 round 2: the previous
        // version of this line, `now - (legIds.length - 1 - i) * day`, is an
        // increasing function of i, so it left physical order and age
        // AGREEING instead of reversing them, and `trueOldestLegId` below
        // was therefore bound to the actual NEWEST leg, not the oldest --
        // the same "spec unmeetable by a correct fix" hazard god just flagged
        // for test 1, but from a fixture bug rather than a modeling one.)
        const createdAt = new Date(now - i * 24 * 3600 * 1000);
        await ctx.prisma.shipmentLeg.update({ where: { id: legIds[i] }, data: { createdAt } });
      }
      const trueOldestLegId = legIds[legIds.length - 1]!;

      // Exactly one driver, cap 1 -- only one of the 8 can be offered this tick.
      await makeDriver('CAYO');
      await dispatch.sweepUndispatched();

      const assigned = await ctx.prisma.shipmentLeg.findMany({
        where: { id: { in: legIds }, courierStatus: 'ASSIGNED' },
        select: { id: true },
      });
      expect(assigned).toHaveLength(1);
      // THE SPEC: the oldest waiting leg is offered first, regardless of
      // insertion/physical order. FAILS on current main -- sweepUndispatched
      // has no orderBy, so the leg actually offered is governed by physical
      // scan order, not age, and is NOT the leg that is oldest by createdAt.
      expect(assigned[0]!.id).toBe(trueOldestLegId);
    } finally {
      await ctx.prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
  });
});

describe('DISPATCH-2 / manual-assign hold: an ASSIGNED leg with offerExpiresAt=null never releases its driver’s capacity', () => {
  // Round 2: god's ruling on this card gives the design's first half
  // outright ("no auto-release of a human assignment") -- pinned below,
  // still PASSES on current main, now as a confirmed-correct behaviour
  // rather than an undesigned one.
  //
  // Round 3: god's correction — staleness is not an event (nothing OCCURS;
  // an unanswered assignment is an absence, measured as elapsed time), so an
  // AuditAction member was the wrong mechanism regardless of which name was
  // picked. The real mechanism needs NO schema change: `assignedAt` and
  // `acceptedAt` already exist on `ShipmentLeg`
  // (packages/database/prisma/schema.prisma:2067-2068) — a consumer derives
  // "silent for N days" from the two, a read rather than a stored flag.
  //
  // God cited the surface as `shipping.controller.ts:979`/`:984`
  // (`GET legs` / `GET legs/:id`) as "the admin leg read". Checked on
  // `origin/main` (3 commits ahead of this worktree at the time) as the
  // floor standard requires, not trusted from memory: those exact lines ARE
  // `@Get('legs')`/`@Get('legs/:id')` — but on `ShippingProviderLegsController`
  // (`@Controller('shipping/provider')`, `@Roles('SHIPPING_PROVIDER')`,
  // `shipping.controller.ts:974/979/984`), which is the CARRIER's own
  // self-service view of their LINE_HAUL legs only
  // (`shipping-provider.service.ts:540`, `kind: 'LINE_HAUL'`,
  // `operatedByProviderId: { in: orgIds }`) — not reachable by an admin
  // without that role, and wrong `kind` filter for this DIRECT leg even if
  // it were. The actual admin/staff read for a courier leg like this one is
  // `GET admin/logistics/shipments/:reference` (`shipping.controller.ts:703`
  // on origin/main) → `ShipmentService.track(..., { isStaff: true })` →
  // `serialize(..., { audience: 'STAFF' })`.
  //
  // THE ANSWER TO THE THING GOD ASKED ME TO CHECK AND NOT LET PASS SILENTLY:
  // that STAFF-audience leg serializer already returns `courierStatus`,
  // `assignedDriverProfileId`, `departedAt`, `arrivedAt`, `startedAt`,
  // `completedAt`, etc. (`shipment.service.ts:4247-4314`) — but it does
  // NOT currently include `assignedAt` or `acceptedAt` anywhere in that
  // object. So this is NOT "needs nothing from Pam, DISPATCH-3 (admin UI)
  // alone" — the backend needs a small, real change (exposing two fields
  // that already exist on the model, through this one serializer), on top
  // of whatever DISPATCH-3 does with them. Asserted below as a normal red
  // test against the real admin endpoint, not guessed from the policy.
  it('holds a concurrency slot indefinitely after a manual assign, blocking a brand-new shipment to the same driver', async () => {
    const district = 'ORANGE_WALK';
    const driver = await makeDriver(district, { online: true });
    const { cookies: senderCookies } = await fundedCustomer();

    // Automatic OFF while booking shipment A, so the booking's own
    // synchronous dispatchLeg call can't grab it first -- isolates the
    // manual-assign path exactly, same technique the admin-assign tests
    // elsewhere in this suite use.
    await setDispatch({ automatic: false, maxConcurrentPerDriver: 1 });
    const shipmentAId = await bookDirect(senderCookies, district, 'Orange Walk Town');
    const legA = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: shipmentAId } });
    let shipmentBId: string | undefined;
    try {
      const assignRes = await post(admin, `admin/logistics/legs/${legA.id}/assign`, {
        driverProfileId: driver.driverProfileId,
        vehicleId: driver.vehicleId,
      });
      expect(assignRes.status).toBe(201);

      const afterAssign = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legA.id } });
      expect(afterAssign.courierStatus).toBe('ASSIGNED');
      expect(afterAssign.assignedDriverProfileId).toBe(driver.driverProfileId);
      expect(afterAssign.offerExpiresAt).toBeNull();
      expect(afterAssign.acceptedAt).toBeNull();

      // THE LEAK, pinned directly: no amount of "time" releases it, because
      // sweepExpiredOffers only matches offerExpiresAt < now, and null never
      // satisfies that. Driving several forced-future sweeps proves it is not
      // merely "hasn't expired yet" -- it structurally cannot expire.
      for (let i = 0; i < 5; i++) {
        await dispatch.sweepExpiredOffers(FUTURE);
      }
      const stillHeld = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legA.id } });
      expect(stillHeld.courierStatus).toBe('ASSIGNED');
      expect(stillHeld.assignedDriverProfileId).toBe(driver.driverProfileId);
      expect(stillHeld.offerExpiresAt).toBeNull();
      expect(stillHeld.acceptedAt).toBeNull();

      // THE OBSERVABLE HALF (god's ruling, round 3): a consumer of the real
      // admin read must be able to derive "silent for N days" itself, from
      // `assignedAt` (non-null, when it happened) and `acceptedAt` (null,
      // confirming nobody has answered since). FAILS on current main: the
      // STAFF leg serializer does not expose either field today (see the
      // comment above this test for the file:line trail) — `toHaveProperty`
      // catches an absent key, which `.not.toBeNull()` alone would miss
      // (undefined is not null).
      const shipmentARef = await ctx.prisma.shipment
        .findUniqueOrThrow({ where: { id: shipmentAId }, select: { reference: true } })
        .then((s) => s.reference);
      const trackRes = await request(ctx.server).get(`/api/admin/logistics/shipments/${shipmentARef}`).set('Cookie', admin);
      expect(trackRes.status).toBe(200);
      const legAOut = (trackRes.body.legs as Array<{ id: string }>).find((l) => l.id === legA.id) as
        | { assignedAt?: unknown; acceptedAt?: unknown }
        | undefined;
      expect(legAOut).toBeDefined();
      expect(legAOut).toHaveProperty('assignedAt');
      expect(typeof legAOut!.assignedAt).toBe('string');
      expect(legAOut).toHaveProperty('acceptedAt');
      expect(legAOut!.acceptedAt).toBeNull();

      // Now prove the consequence: a brand-new shipment to the SAME driver
      // (the only one eligible in this district) can never be offered, because
      // rankFor's capacity filter (activeDeliveries < maxConcurrent) counts
      // the still-ASSIGNED leg A against the cap -- which is exactly 1 here,
      // already fully consumed by the leak.
      await setDispatch({ automatic: true, maxConcurrentPerDriver: 1 });
      shipmentBId = await bookDirect(senderCookies, district, 'Orange Walk Town');
      const legB = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: shipmentBId } });
      for (let i = 0; i < 5; i++) {
        await dispatch.sweepUndispatched();
      }
      const legBAfter = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legB.id } });
      expect(legBAfter.assignedDriverProfileId).toBeNull();
      expect(legBAfter.courierStatus).not.toBe('ASSIGNED');
    } finally {
      await ctx.prisma.shipment.deleteMany({ where: { id: { in: [shipmentAId, ...(shipmentBId ? [shipmentBId] : [])] } } });
    }
  });
});

describe('MDF-646 / DISPATCH-5: a sweep tick that read a now-stale driver must not overwrite a fresher reassignment', () => {
  // The real race: sweepExpiredOffers() reads `{ id, assignedDriverProfileId }`
  // for every lapsed offer in ONE findMany, then calls the private
  // expireOffer(legId, thatDriverId) per leg. If an admin's REASSIGN commits
  // in the gap between that read and expireOffer's own write, expireOffer's
  // WHERE (before this fix: id + courierStatus + acceptedAt, no driver check)
  // still matches — REASSIGN leaves the leg ASSIGNED/acceptedAt-null, same
  // shape as a genuinely-lapsed offer — so the stale expiry silently reverts
  // the admin's fresh assignment to a DIFFERENT driver, audited as "offer
  // expired" rather than "a reassignment got reverted".
  //
  // Reproduced deterministically rather than via real concurrency (which
  // would be a flaky, timing-dependent test for an outcome this specific):
  // `expireOffer` is called directly with the STALE driver id, exactly the
  // argument a sweep tick would be holding at the moment it lost the race —
  // the same shape of direct-private-call test `sweepExpiredOffers`'s own
  // callers in this file already use for `sweepUndispatched`/
  // `sweepExpiredOffers` themselves.
  it('a stale expireOffer(legId, oldDriver) is a no-op once the leg has been reassigned to a new driver', async () => {
    const district = 'COROZAL';
    const driverX = await makeDriver(district, { online: true });
    const driverY = await makeDriver(district, { online: true });
    const { cookies: senderCookies } = await fundedCustomer();

    await setDispatch({ automatic: false });
    const shipmentId = await bookDirect(senderCookies, district, 'Corozal Town');
    let leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });
    try {
      const assignRes = await post(admin, `admin/logistics/legs/${leg.id}/assign`, {
        driverProfileId: driverX.driverProfileId,
        vehicleId: driverX.vehicleId,
      });
      expect(assignRes.status).toBe(201);

      const reassignRes = await post(admin, `admin/logistics/legs/${leg.id}/reassign`, {
        driverProfileId: driverY.driverProfileId,
        vehicleId: driverY.vehicleId,
        reason: 'Driver X went offline; reassigning to Y.',
      });
      expect(reassignRes.status).toBe(201);
      leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
      expect(leg.assignedDriverProfileId).toBe(driverY.driverProfileId);
      expect(leg.courierStatus).toBe('ASSIGNED');
      expect(leg.acceptedAt).toBeNull();

      // The stale sweep call: it read driver X before the reassignment, and
      // is only now trying to commit the expiry it decided on back then.
      const staleExpired = await (dispatch as unknown as { expireOffer: (legId: string, driverProfileId: string | null) => Promise<boolean> }).expireOffer(
        leg.id,
        driverX.driverProfileId,
      );
      expect(staleExpired).toBe(false);

      const afterStaleExpiry = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
      expect(afterStaleExpiry.assignedDriverProfileId).toBe(driverY.driverProfileId);
      expect(afterStaleExpiry.courierStatus).toBe('ASSIGNED');
      expect(afterStaleExpiry.acceptedAt).toBeNull();
      expect(afterStaleExpiry.declineReason).toBeNull();

      // Sanity: expireOffer still works when given the driver the leg is
      // ACTUALLY currently assigned to — the fix narrows the match, it does
      // not break the ordinary, non-raced expiry path.
      const freshExpired = await (dispatch as unknown as { expireOffer: (legId: string, driverProfileId: string | null) => Promise<boolean> }).expireOffer(
        leg.id,
        driverY.driverProfileId,
      );
      expect(freshExpired).toBe(true);
      const afterFreshExpiry = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
      expect(afterFreshExpiry.assignedDriverProfileId).toBeNull();
      expect(afterFreshExpiry.courierStatus).toBe('DRIVER_DECLINED');
    } finally {
      await ctx.prisma.shipment.deleteMany({ where: { id: shipmentId } });
    }
  });
});
