/**
 * BMPL-177 (business half): the vendor-hours consumer of VendorOpeningHours
 * (BMPL-259 ruling 10). Same owner ruling as BMPL-273/287 for terminal
 * hours and shipment availability windows, extended here to marketplace
 * dispatch's own "collect from business" instant: when a driver's
 * automatically-dispatched pickup would reach the vendor while it is
 * outside its configured opening hours, WARN AND SCHEDULE INTO A FUTURE
 * OPEN WINDOW — never refuse outright, and never silently proceed as if
 * nothing were wrong. `DispatchEngineService.dispatch` is called repeatedly
 * (vendor marking ready, the sweeper, and after a decline) so "reschedule"
 * needs no persisted state of its own: a delivery that is not yet
 * dispatchable is simply left unoffered, and the very next call — with a
 * later `now` — re-evaluates it.
 *
 * Two things this file exists specifically to prove, per the card:
 *  - an UNCONFIGURED vendor (every vendor before this card, and any vendor
 *    who never sets hours after it) produces the IDENTICAL outcome as
 *    before this card — not merely "no error thrown".
 *  - the deferral and the self-correcting re-dispatch actually HAPPEN, not
 *    just "nothing broke".
 *
 * No projected-pickup-plus-travel-time test exists here, unlike the hub
 * case: OrderDelivery has no durationMinutes-style travel estimate for a
 * driver's trip TO the vendor (unlike a shipment leg's own field), so the
 * projected pickup instant is `now` itself — see
 * DispatchEngineService.dispatch's own comment for why that is not an
 * omission. Out of scope, deliberately: the customer-facing "closed / may
 * close before arrival" badge is the web half and is held separately so it
 * does not ship before this behaviour is live (root CLAUDE.md's
 * no-fabricated-capability rule). No checkout gating, no UI.
 *
 * BMPL-334 adds a second describe block below: dated exceptions
 * (VendorHoursException), driving dispatch through the real self-service
 * write endpoint rather than a direct Prisma write, and asserting the
 * "unconfigured-except-one-date" property explicitly rather than leaving it
 * to the shared resolver's accident (per the dispatch's own instruction).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { DispatchEngineService } from '../src/dispatch/dispatch-engine.service';

let ctx: TestContext;
let engine: DispatchEngineService;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

/** Belize is a fixed UTC-6, no DST (belize-time.ts). 2026-11-02 is a Monday. */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeVendor() {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Store ${s}`,
      slug: `store-${s}`,
      contactEmail: `v${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { cookies, vendorProfileId: vp.id, productId: product.id };
}

async function readyDelivery(vendor: { vendorProfileId: string; productId: string }, opts: { district?: string } = {}) {
  const district = opts.district ?? 'BELIZE';
  const s = uniq();
  const { userId: customerId } = await registerCustomer(`cust_${s}@example.bz`);
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num,
      userId: customerId,
      status: 'PENDING',
      itemCount: 1,
      subtotalMinor: 1000n,
      deliveryFeeMinor: 500n,
      totalMinor: 1500n,
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', addressLine1: '5 Ave', city: 'Belize City', district: district as never } },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: 'READY_FOR_PICKUP',
          readyForPickupAt: new Date(),
          deliveryMethod: 'DELIVERY',
          itemCount: 1,
          subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n, readyForDispatchAt: new Date() } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return { deliveryId: order.vendorOrders[0]!.delivery!.id, customerId };
}

async function makeDriver(districts: string[] = ['BELIZE']) {
  const s = uniq();
  const { userId } = await registerCustomer(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: districts[0] as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const d of districts) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { driverProfileId: profile.id };
}

/** Turn automatic dispatch on for a test. Production default is OFF. */
async function enableDispatch(over: Record<string, unknown> = {}) {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 5, dispatchMaxConcurrentPerDriver: 3, ...over };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** All 7 days, the same window — mirrors setHubHours in the shipment case,
 *  through the vendor's OWN self-service write endpoint (BMPL-259), so this
 *  file also proves that surface actually reaches dispatch, not just a
 *  hand-written row. */
async function setVendorHours(cookies: string[], openTime: string, closeTime: string) {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime, closeTime }));
  expect((await put(cookies, 'vendor/profile/hours', { hours })).status).toBe(200);
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(201);
  adminCookies = cookiesOf(login);
  void adminCookies;
  const cat = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}`, isVisible: true } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
});
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await enableDispatch();
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

describe('automatic dispatch — vendor pickup feasibility (BMPL-177 business half)', () => {
  it('an UNCONFIGURED vendor dispatches exactly as before this card', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('ASSIGNED');

    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('defers (never offers) when the projected pickup instant is outside the vendor\'s configured hours, and re-dispatches on its own once a later `now` lands inside the next open window', async () => {
    const vendor = await makeVendor();
    await setVendorHours(vendor.cookies, '08:00', '17:00');
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();

    // Monday 19:00 Belize local — two hours after the shop locks up.
    const outsideHours = belizeInstant(2026, 11, 2, 19, 0);
    const deferred = await engine.dispatch(deliveryId, outsideHours);
    expect(deferred.result).toBe('DEFERRED');
    expect((deferred as { reason: string }).reason).toMatch(/outside its configured hours/);

    // The warning changed nothing: no driver was contacted, no offer budget spent.
    const stillWaiting = await deliveryOf(deliveryId);
    expect(stillWaiting.assignedDriverProfileId).toBeNull();
    expect(stillWaiting.status).toBe('PENDING_ASSIGNMENT');
    expect(stillWaiting.offerCount).toBe(0);

    // Tuesday 09:00 Belize local — inside the same configured window. Same
    // delivery, same call, only `now` has moved forward — exactly what the
    // real 20s sweeper does tick after tick.
    const insideHours = belizeInstant(2026, 11, 3, 9, 0);
    const offered = await engine.dispatch(deliveryId, insideHours);
    expect(offered.result).toBe('ASSIGNED');
    expect((offered as { driverProfileId: string }).driverProfileId).toBe(driver.driverProfileId);

    const dispatched = await deliveryOf(deliveryId);
    expect(dispatched.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(dispatched.status).toBe('ASSIGNED');
  });

  it('a vendor closed all day (isClosed) defers exactly like an outside-window instant, not an error', async () => {
    const vendor = await makeVendor();
    const hours = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: true }));
    expect((await put(vendor.cookies, 'vendor/profile/hours', { hours })).status).toBe(200);
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();

    const outcome = await engine.dispatch(deliveryId, belizeInstant(2026, 11, 2, 12, 0));
    expect(outcome.result).toBe('DEFERRED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBeNull();
  });
});

/**
 * The deferral above is invisible today — a return value nobody persists or
 * reads. This makes it visible to OPERATIONS via an audit record of the
 * decision, written on the TRANSITION into deferred only (never once per
 * 20s sweeper tick), with the transition back out already covered by the
 * pre-existing DELIVERY_AUTO_ASSIGNED row. Same shape as BMPL-275, ported.
 */
describe('automatic dispatch — vendor-hours deferral is visible to operations (BMPL-177)', () => {
  const deferralRowsFor = (deliveryId: string) =>
    ctx.prisma.auditLog.findMany({ where: { action: 'DELIVERY_DISPATCH_DEFERRED', newValue: { path: ['deliveryId'], equals: deliveryId } } });
  const assignedRowsFor = (deliveryId: string) =>
    ctx.prisma.auditLog.count({ where: { action: 'DELIVERY_AUTO_ASSIGNED', newValue: { path: ['deliveryId'], equals: deliveryId } } });

  it('an UNCONFIGURED vendor writes no deferral audit row at all, across repeated dispatch attempts', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();

    // Three "sweeps" — the first dispatches for real, the rest are no-ops
    // because the delivery is already assigned. Not one of them should ever
    // write a deferral row: the vendor has zero configured rows.
    await engine.dispatch(deliveryId);
    await engine.dispatch(deliveryId);
    await engine.dispatch(deliveryId);

    expect(await deferralRowsFor(deliveryId)).toHaveLength(0);
  });

  it('a configured vendor that defers writes exactly ONE audit row across repeated sweeps, and no second row once it clears', async () => {
    const vendor = await makeVendor();
    await setVendorHours(vendor.cookies, '08:00', '17:00');
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();

    // Three consecutive sweeps at the SAME outside-hours instant — exactly
    // what a vendor closed overnight looks like to a 20s sweeper. A naive
    // "record on every deferral" implementation would write three rows here.
    const outsideHours = belizeInstant(2026, 11, 2, 19, 0);
    expect((await engine.dispatch(deliveryId, outsideHours)).result).toBe('DEFERRED');
    expect((await engine.dispatch(deliveryId, outsideHours)).result).toBe('DEFERRED');
    expect((await engine.dispatch(deliveryId, outsideHours)).result).toBe('DEFERRED');

    const afterThreeSweeps = await deferralRowsFor(deliveryId);
    expect(afterThreeSweeps).toHaveLength(1);
    expect(afterThreeSweeps[0]!.reason).toMatch(/outside its configured hours/);
    expect(afterThreeSweeps[0]!.reason).toMatch(/next open/);

    // It clears: a later sweep lands inside the window and dispatches.
    const insideHours = belizeInstant(2026, 11, 3, 9, 0);
    const cleared = await engine.dispatch(deliveryId, insideHours);
    expect(cleared.result).toBe('ASSIGNED');
    expect((cleared as { driverProfileId: string }).driverProfileId).toBe(driver.driverProfileId);

    // No second deferral row was written to mark the clearing — the
    // DELIVERY_AUTO_ASSIGNED row that dispatch always writes already is
    // that event in the trail.
    expect(await deferralRowsFor(deliveryId)).toHaveLength(1);
    expect(await assignedRowsFor(deliveryId)).toBe(1);
  });

  it('a new deferral episode after a prior dispatch gets its own row, not folded into the old one', async () => {
    // First episode: vendor unconfigured, dispatches immediately for real —
    // this is the genuine DELIVERY_AUTO_ASSIGNED row a later deferral must
    // be told apart from.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect(await assignedRowsFor(deliveryId)).toBe(1);

    // Roll the delivery back to unassigned without going through the real
    // decline endpoint's own synchronous re-offer (which would race the
    // real wall clock) — same technique the shipment-leg equivalent test
    // uses, leaves the row exactly as a real decline would.
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { status: 'DRIVER_DECLINED', assignedDriverProfileId: null, assignedVehicleId: null, offerExpiresAt: null },
    });

    // Only now does the vendor get hours configured, and the retry lands
    // outside them.
    await setVendorHours(vendor.cookies, '08:00', '17:00');
    const deferred = await engine.dispatch(deliveryId, belizeInstant(2026, 11, 2, 19, 0));
    expect(deferred.result).toBe('DEFERRED');

    // The most recent event for this delivery was ASSIGNED, not DEFERRED,
    // so this is correctly recognised as a NEW episode and gets its own
    // row — one ASSIGNED row and one DEFERRED row, not zero.
    expect(await deferralRowsFor(deliveryId)).toHaveLength(1);
    expect(await assignedRowsFor(deliveryId)).toBe(1);
  });
});

/**
 * BMPL-334: dated exceptions. Driven through the real self-service write
 * endpoint (`POST vendor/profile/hours/exceptions`), the same discipline
 * setVendorHours above already applies to the weekly pattern — proves the
 * write surface actually reaches dispatch, not just a hand-written row.
 */
describe('automatic dispatch — vendor dated exceptions (BMPL-334)', () => {
  async function addException(cookies: string[], date: string, body: Record<string, unknown>) {
    const res = await post(cookies, 'vendor/profile/hours/exceptions', { date, ...body });
    expect(res.status).toBe(201);
  }

  it('a CLOSED exception defers dispatch on that date, and self-corrects the next day', async () => {
    const vendor = await makeVendor();
    // 2026-12-25 is a Friday; a synthetic test date, never a real Belize holiday.
    await addException(vendor.cookies, '2026-12-25', { status: 'CLOSED', reason: 'Synthetic test closure' });
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();

    const onClosedDate = await engine.dispatch(deliveryId, belizeInstant(2026, 12, 25, 12, 0));
    expect(onClosedDate.result).toBe('DEFERRED');
    expect((onClosedDate as { reason: string }).reason).toMatch(/outside its configured hours/);

    const nextDay = await engine.dispatch(deliveryId, belizeInstant(2026, 12, 26, 12, 0));
    expect(nextDay.result).toBe('ASSIGNED');
    expect((nextDay as { driverProfileId: string }).driverProfileId).toBe(driver.driverProfileId);
  });

  it('a MODIFIED exception constrains dispatch to the override window, not the (absent) weekly pattern', async () => {
    const vendor = await makeVendor();
    await addException(vendor.cookies, '2026-12-25', { status: 'MODIFIED', openTime: '10:00', closeTime: '13:00', reason: 'Synthetic: reduced hours' });
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();

    const beforeWindow = await engine.dispatch(deliveryId, belizeInstant(2026, 12, 25, 9, 0));
    expect(beforeWindow.result).toBe('DEFERRED');

    const insideWindow = await engine.dispatch(deliveryId, belizeInstant(2026, 12, 25, 11, 0));
    expect(insideWindow.result).toBe('ASSIGNED');
  });

  /**
   * THE PROPERTY god asked to be decided in code and asserted by a test,
   * not left to the resolver's accident: a vendor with ONLY an exception
   * row and ZERO VendorOpeningHours rows is unconstrained on every OTHER
   * date — the exception check wins for its own date regardless of whether
   * a weekly pattern exists at all, and dispatch falls through to
   * unconstrained (identical to a fully unconfigured vendor) everywhere
   * else. Two deliveries, same vendor, same exception, two different
   * dates either side of it.
   */
  it('unconfigured-except-one-date: no weekly pattern at all, one exception — every OTHER date dispatches exactly like an unconfigured vendor', async () => {
    const vendor = await makeVendor();
    await addException(vendor.cookies, '2026-12-25', { status: 'CLOSED', reason: 'Synthetic test closure' });

    // The excepted date itself: deferred, exactly as the test above proves.
    const onException = await readyDelivery(vendor);
    const driverA = await makeDriver();
    expect((await engine.dispatch(onException.deliveryId, belizeInstant(2026, 12, 25, 12, 0))).result).toBe('DEFERRED');

    // A different date, same vendor, same (still-empty) weekly pattern: no
    // exception row matches, so this is UNCONSTRAINED — dispatches exactly
    // as an unconfigured vendor would, not "closed by default" and not
    // "blocked because SOME exception exists for this vendor".
    const onOrdinaryDate = await readyDelivery(vendor);
    const outcome = await engine.dispatch(onOrdinaryDate.deliveryId, belizeInstant(2026, 12, 10, 3, 0));
    expect(outcome.result).toBe('ASSIGNED');
    expect((outcome as { driverProfileId: string }).driverProfileId).toBe(driverA.driverProfileId);
  });
});
