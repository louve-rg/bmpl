/**
 * EDW-P3 — an explicit pass is not an expired offer.
 *
 * Edward's requirement, once automatic dispatch has cycled through every
 * eligible driver without anybody accepting:
 *
 *   explicit pass               -> Unclaimed only, still claimable
 *   offer expired / no response -> Available AND Unclaimed, claimable
 *   never offered, now eligible -> Available AND Unclaimed, claimable
 *   taken by another driver     -> neither
 *   no longer eligible          -> neither
 *
 * The defect this file covers is a STORAGE defect, not a presentation one:
 * both dispatch surfaces closed a lapsed offer by writing the same row an
 * explicit refusal writes (status = DECLINED), so no query could tell a
 * decision from a timeout. The `resolution` column is what makes the
 * distinction real, and these tests assert it at the database as well as
 * through the two driver-facing lists.
 *
 * Both surfaces are covered: marketplace delivery dispatch (`describe`s
 * prefixed M) and shipment courier-leg dispatch (prefixed L). Each matrix row
 * is named in its own test title.
 *
 * Driven through the engine directly rather than the 20-second sweepers, for
 * the same reason `dispatch-engine.integration.spec.ts` does it: a test that
 * waits out real timeouts is slow and flaky, and the sweeper's only job is to
 * call these same methods on a timer.
 *
 * NOTE ON `-t`: every `it` here creates its own fixtures and shares no
 * closure state with any other, so a name filter is safe on this file —
 * unlike the files root CLAUDE.md warns about. The `beforeEach` that parks
 * existing drivers is what keeps each test's candidate pool to the drivers it
 * made itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, raceOverSeparateConnections, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { DispatchEngineService } from '../src/dispatch/dispatch-engine.service';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let engine: DispatchEngineService;
let legDispatch: ShipmentDispatchService;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

// `claim.claimPath` comes back root-relative with a leading slash and no
// `/api` prefix — the form the web client's own helper takes — so this strips
// one leading slash rather than producing `/api//driver/...`.
const post = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).post(`/api/${p.replace(/^\//, '')}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const patch = (c: string[], p: string, b: object = {}) =>
  request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

async function loginAgain(email: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password: 'CustomerPass123' });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function makeVendor() {
  const s = uniq();
  const { userId } = await registerUser(`vend_${s}@example.bz`);
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
  return { vendorProfileId: vp.id, productId: product.id };
}

/** A delivery the vendor has marked ready — the only kind the engine may offer. */
async function readyDelivery(vendor: { vendorProfileId: string; productId: string }) {
  const s = uniq();
  const { userId: customerId } = await registerUser(`cust_${s}@example.bz`);
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
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' } },
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

/**
 * A DIRECT courier leg that is ready for a driver. `quotedTotalMinor` 0 is
 * paid-by-definition (nothing was owed), which is the shape
 * `isShipmentPaidForDispatch` already allows — so these tests exercise the
 * dispatch rules, not the payment rail, which has nothing behind it.
 */
async function readyLeg() {
  const s = uniq();
  const { userId: customerUserId } = await registerUser(`send_${s}@example.bz`);
  const shipment = await ctx.prisma.shipment.create({
    data: {
      reference: `EDW3-${s}`,
      service: 'DOOR_TO_DOOR',
      status: 'AWAITING_PICKUP',
      description: 'One box',
      pieces: 1,
      customerUserId,
      originCity: 'Belize City',
      originDistrict: 'BELIZE',
      destinationCity: 'Belize City',
      destinationDistrict: 'BELIZE',
    },
  });
  const leg = await ctx.prisma.shipmentLeg.create({
    data: {
      shipmentId: shipment.id,
      sequence: 1,
      kind: 'DIRECT',
      mode: 'LAND',
      status: 'READY',
      priceMinor: 1500n,
      durationMinutes: 60,
    },
  });
  return { legId: leg.id, shipmentId: shipment.id, customerUserId };
}

async function makeDriver(
  opts: { availability?: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE'; districts?: string[]; vehicleApproval?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {},
) {
  const s = uniq();
  const { cookies, userId, email } = await registerUser(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Drv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `DL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: opts.availability ?? 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR',
      make: 'Toyota',
      model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE,
      insuranceExpiry: FUTURE,
      isActive: true,
      isPrimary: true,
      approvalStatus: opts.vehicleApproval ?? 'APPROVED',
    },
  });
  for (const d of opts.districts ?? ['BELIZE']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, email, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Full tuning set every time — platform_settings is a singleton. */
async function enableDispatch(over: Record<string, unknown> = {}) {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = {
    dispatchAutomatic: true,
    dispatchOfferTimeoutSeconds: 90,
    dispatchMaxOffers: 5,
    dispatchMaxConcurrentPerDriver: 3,
    ...over,
  };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });
const legOf = (id: string) => ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id } });

/** The two driver-facing lists, as the driver app reads them. */
async function listsFor(cookies: string[]) {
  const available = await get(cookies, 'driver/jobs?scope=available');
  expect(available.status).toBe(200);
  const unclaimed = await get(cookies, 'driver/jobs/claimable');
  expect(unclaimed.status).toBe(200);
  return {
    available: available.body as Array<{ id: string; claim?: { youPassed: boolean; inAvailableJobs: boolean; claimPath: string } }>,
    unclaimed: unclaimed.body as Array<{ id: string; kind: string; claim: { youPassed: boolean; inAvailableJobs: boolean; claimPath: string } }>,
  };
}
const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

/**
 * Offer a delivery to one driver, have them explicitly pass, then let the
 * rotation run out. `dispatchMaxOffers: 1` is what makes "everyone has been
 * asked" reachable in one step — the same EXHAUSTED state a long rotation
 * ends in, which is the state Edward's requirement is about.
 */
async function offerThenExplicitPass(deliveryId: string, driver: { cookies: string[] }) {
  await enableDispatch({ dispatchMaxOffers: 1 });
  expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
  expect((await post(driver.cookies, `driver/jobs/${deliveryId}/decline`, { reason: 'Too far today' })).status).toBe(201);
  expect((await engine.dispatch(deliveryId)).result).toBe('EXHAUSTED');
}

/** Offer a delivery to one driver and let the offer lapse, then exhaust. */
async function offerThenExpire(deliveryId: string) {
  await enableDispatch({ dispatchMaxOffers: 1 });
  expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
  // Wind the clock back on the offer rather than sleeping, then run the
  // sweeper exactly as the scheduler would.
  await ctx.prisma.orderDelivery.update({
    where: { id: deliveryId },
    data: { offerExpiresAt: new Date(Date.now() - 1000) },
  });
  const swept = await engine.sweepExpiredOffers();
  expect(swept.expired).toBe(1);
  expect((await engine.dispatch(deliveryId)).result).toBe('EXHAUSTED');
}

async function offerLegThenExplicitPass(legId: string, driver: { cookies: string[] }) {
  await enableDispatch({ dispatchMaxOffers: 1 });
  expect((await legDispatch.dispatchLeg(legId)).result).toBe('OFFERED');
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/decline`, { reason: 'Not today' })).status).toBe(201);
  expect((await legDispatch.dispatchLeg(legId)).result).toBe('EXHAUSTED');
}

async function offerLegThenExpire(legId: string) {
  await enableDispatch({ dispatchMaxOffers: 1 });
  expect((await legDispatch.dispatchLeg(legId)).result).toBe('OFFERED');
  await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
  const swept = await legDispatch.sweepExpiredOffers();
  expect(swept.expired).toBe(1);
  expect((await legDispatch.dispatchLeg(legId)).result).toBe('EXHAUSTED');
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(201);
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}`, isVisible: true } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
  legDispatch = ctx.app.get(ShipmentDispatchService);
  await patch(adminCookies, 'admin/ops/settings', { localCourierFeeMinor: 1500, localCourierFeeTestMinor: 1500, localCourierMinutes: 60 });
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await enableDispatch();
  // Park every driver that already exists, so each test's candidate pool is
  // only the drivers it created itself — see dispatch-engine's own note.
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

/* ------------------------------------------------------------------ storage */

describe('EDW-P3 storage — an expiry and an explicit pass are now different rows', () => {
  it('ROOT CAUSE (delivery): expiry writes resolution=EXPIRED, an explicit pass writes DECLINED_BY_DRIVER', async () => {
    const vendor = await makeVendor();

    const expired = await readyDelivery(vendor);
    const driverA = await makeDriver();
    await offerThenExpire(expired.deliveryId);
    await ctx.prisma.driverProfile.update({ where: { id: driverA.driverProfileId }, data: { availability: 'OFFLINE' } });

    const passed = await readyDelivery(vendor);
    const driverB = await makeDriver();
    await offerThenExplicitPass(passed.deliveryId, driverB);

    const expiredRow = await ctx.prisma.deliveryAssignment.findFirstOrThrow({
      where: { orderDeliveryId: expired.deliveryId, driverProfileId: driverA.driverProfileId },
    });
    const passedRow = await ctx.prisma.deliveryAssignment.findFirstOrThrow({
      where: { orderDeliveryId: passed.deliveryId, driverProfileId: driverB.driverProfileId },
    });

    // Both still DECLINED — no existing reader of `status` changed meaning...
    expect(expiredRow.status).toBe('DECLINED');
    expect(passedRow.status).toBe('DECLINED');
    // ...and `resolution` is what tells them apart.
    expect(expiredRow.resolution).toBe('EXPIRED');
    expect(passedRow.resolution).toBe('DECLINED_BY_DRIVER');
  });

  it('ROOT CAUSE (courier leg): same two outcomes, same two resolutions', async () => {
    const expired = await readyLeg();
    const driverA = await makeDriver();
    await offerLegThenExpire(expired.legId);
    await ctx.prisma.driverProfile.update({ where: { id: driverA.driverProfileId }, data: { availability: 'OFFLINE' } });

    const passed = await readyLeg();
    const driverB = await makeDriver();
    await offerLegThenExplicitPass(passed.legId, driverB);

    const expiredRow = await ctx.prisma.shipmentLegOffer.findFirstOrThrow({
      where: { shipmentLegId: expired.legId, driverProfileId: driverA.driverProfileId },
    });
    const passedRow = await ctx.prisma.shipmentLegOffer.findFirstOrThrow({
      where: { shipmentLegId: passed.legId, driverProfileId: driverB.driverProfileId },
    });
    expect(expiredRow.status).toBe('DECLINED');
    expect(passedRow.status).toBe('DECLINED');
    expect(expiredRow.resolution).toBe('EXPIRED');
    expect(passedRow.resolution).toBe('DECLINED_BY_DRIVER');
    // The leg sweeper used to write "Offer expired." into the SAME column a
    // driver's own reason uses, which is exactly why the text could never be
    // the discriminator. It writes nothing there now: `declineReason` means
    // only what a driver actually said, and an expiry is the case where
    // nobody said anything.
    expect(expiredRow.declineReason).toBeNull();
    expect(passedRow.declineReason).toBe('Not today');
  });

  it('MIGRATION RULE: a historical DECLINED row with no resolution is NOT treated as an explicit pass', async () => {
    // The shape the EDW-P3 migration deliberately leaves NULL: status
    // DECLINED, respondedAt NULL, so the stored evidence cannot establish
    // which case it was. "Not established" must err toward showing the driver
    // the job — the direction that cannot wrongly exclude anybody.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);
    await ctx.prisma.deliveryAssignment.updateMany({
      where: { orderDeliveryId: deliveryId, driverProfileId: driver.driverProfileId },
      data: { resolution: null, respondedAt: null },
    });

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).toContain(deliveryId);
    expect(lists.unclaimed.find((j) => j.id === deliveryId)!.claim.youPassed).toBe(false);
  });
});

/* -------------------------------------------- M: marketplace delivery matrix */

describe('EDW-P3 matrix (M) — marketplace delivery, after the rotation is exhausted', () => {
  it('M1 explicit pass -> NOT in Available, STILL in Unclaimed, and still claimable', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExplicitPass(deliveryId, driver);

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).toContain(deliveryId);
    const row = lists.unclaimed.find((j) => j.id === deliveryId)!;
    expect(row.claim.youPassed).toBe(true);
    expect(row.claim.inAvailableJobs).toBe(false);
    // The exact literal the driver app posts verbatim (PR #901 consumes
    // `claim.claimPath` as-is through a helper that prepends the API base):
    // root-relative, leading slash, no `/api`. Pinned because a drift here
    // breaks the frontend silently rather than loudly.
    expect(row.claim.claimPath).toBe(`/driver/jobs/${deliveryId}/claim`);

    // Edward's point: a driver who passed may reconsider.
    expect((await post(driver.cookies, row.claim.claimPath)).status).toBe(201);
    const after = await deliveryOf(deliveryId);
    expect(after.status).toBe('ASSIGNED');
    expect(after.assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('M2 offer expired / no response -> in BOTH lists, and claimable', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).toContain(deliveryId);
    expect(lists.unclaimed.find((j) => j.id === deliveryId)!.claim.youPassed).toBe(false);
    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(201);
  });

  it('M3 a driver who becomes eligible only AFTER the rotation -> in BOTH lists', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const offered = await makeDriver();
    await offerThenExpire(deliveryId);
    await ctx.prisma.driverProfile.update({ where: { id: offered.driverProfileId }, data: { availability: 'OFFLINE' } });

    // Signs on after everything above already happened — never offered this
    // delivery, so nothing they did can read as a refusal.
    const latecomer = await makeDriver();
    const lists = await listsFor(latecomer.cookies);
    expect(idsOf(lists.available)).toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).toContain(deliveryId);
    expect(lists.unclaimed.find((j) => j.id === deliveryId)!.claim.youPassed).toBe(false);
  });

  it('M4 accepted/claimed by another driver -> in NEITHER list for anyone else', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const winner = await makeDriver();
    const other = await makeDriver();
    await offerThenExpire(deliveryId);
    expect((await post(winner.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(201);

    const lists = await listsFor(other.cookies);
    expect(idsOf(lists.available)).not.toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).not.toContain(deliveryId);
    // And the winner's own copy is their job now, not a claimable one.
    const winnerLists = await listsFor(winner.cookies);
    expect(idsOf(winnerLists.unclaimed)).not.toContain(deliveryId);
    expect(winnerLists.available.find((j) => j.id === deliveryId)?.claim).toBeUndefined();
  });

  it('M5 a driver who is no longer eligible -> in NEITHER list, and cannot claim', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);
    expect(idsOf((await listsFor(driver.cookies)).available)).toContain(deliveryId);

    // Eligibility changes mid-dispatch: the vehicle's approval is withdrawn.
    await ctx.prisma.driverVehicle.update({ where: { id: driver.vehicleId }, data: { approvalStatus: 'REJECTED' } });

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).not.toContain(deliveryId);
    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(400);
  });

  it('M6 cancelled while visible in either list -> drops out of both, claim refused', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);
    expect(idsOf((await listsFor(driver.cookies)).unclaimed)).toContain(deliveryId);

    expect((await post(adminCookies, `admin/deliveries/${deliveryId}/cancel`, { reason: 'Customer changed their mind' })).status).toBe(201);

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).not.toContain(deliveryId);
    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(404);
  });

  it('the Available tab badge counts exactly what the Available tab returns', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);

    const counts = await get(driver.cookies, 'driver/jobs/counts');
    expect(counts.status).toBe(200);
    const lists = await listsFor(driver.cookies);
    expect(counts.body.available).toBe(lists.available.length);
    expect(lists.available.length).toBeGreaterThan(0);
  });

  it('a claimable job in Available carries no address, coordinates or contact details', async () => {
    // This pool is readable by EVERY eligible driver at once, so it is held to
    // the stricter area-only rule, not the offered-job rule.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);

    const lists = await listsFor(driver.cookies);
    const row = lists.unclaimed.find((j) => j.id === deliveryId)! as unknown as {
      pickup: Record<string, unknown>;
      dropoff: Record<string, unknown>;
    };
    for (const end of [row.pickup, row.dropoff]) {
      expect(end.address).toBeNull();
      expect(end.phone).toBeNull();
      expect(end.pinnedLocation).toBeNull();
      expect(end.navigationUrl).toBeNull();
    }
    expect(row.dropoff.name).toBeNull();
    expect(row.dropoff.area).toBeTruthy();
  });
});

/* ------------------------------------------------ L: courier-leg matrix */

describe('EDW-P3 matrix (L) — shipment courier leg, after the rotation is exhausted', () => {
  it('L1 explicit pass -> NOT in Available, STILL in Unclaimed, and still claimable', async () => {
    const { legId } = await readyLeg();
    const driver = await makeDriver();
    await offerLegThenExplicitPass(legId, driver);

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    const row = lists.unclaimed.find((j) => j.id === legId);
    expect(row).toBeDefined();
    expect(row!.claim.youPassed).toBe(true);
    expect(row!.claim.inAvailableJobs).toBe(false);
    expect(row!.kind).toBe('DIRECT');
    // Same literal shape as the delivery row, on the leg route (PR #901).
    expect(row!.claim.claimPath).toBe(`/driver/jobs/legs/${legId}/claim`);

    expect((await post(driver.cookies, row!.claim.claimPath)).status).toBe(201);
    const after = await legOf(legId);
    expect(after.courierStatus).toBe('ASSIGNED');
    expect(after.assignedDriverProfileId).toBe(driver.driverProfileId);
    // A claim does not lapse, and the exhausted marker is deliberately left
    // in place so a later decline returns the leg to the pool.
    expect(after.offerExpiresAt).toBeNull();
    expect(after.dispatchExhaustedAt).not.toBeNull();
  });

  it('L2 offer expired / no response -> in BOTH lists, and claimable', async () => {
    const { legId } = await readyLeg();
    const driver = await makeDriver();
    await offerLegThenExpire(legId);

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).toContain(legId);
    expect(idsOf(lists.unclaimed)).toContain(legId);
    const row = lists.unclaimed.find((j) => j.id === legId)! as unknown as {
      reference: string; load: string; pickup: { area: string | null }; dropoff: { area: string | null };
      claim: { youPassed: boolean; dispatchExhaustedAt: string };
    };
    expect(row.claim.youPassed).toBe(false);
    // The four fields the driver app renders for a courier leg (PR #901),
    // asserted here so the contract it was built against is pinned by a test
    // against the real response rather than by prose.
    expect(row.reference).toMatch(/^EDW3-/);
    expect(row.load).toBeTruthy();
    expect(row.pickup.area).toBeTruthy();
    expect(row.dropoff.area).toBeTruthy();
    expect(row.claim.dispatchExhaustedAt).toBeTruthy();
    expect((await post(driver.cookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(201);
  });

  it('L3 a driver who becomes eligible only AFTER the rotation -> in BOTH lists', async () => {
    const { legId } = await readyLeg();
    const offered = await makeDriver();
    await offerLegThenExpire(legId);
    await ctx.prisma.driverProfile.update({ where: { id: offered.driverProfileId }, data: { availability: 'OFFLINE' } });

    const latecomer = await makeDriver();
    const lists = await listsFor(latecomer.cookies);
    expect(idsOf(lists.available)).toContain(legId);
    expect(idsOf(lists.unclaimed)).toContain(legId);
  });

  it('L4 taken by another driver -> in NEITHER list for anyone else', async () => {
    const { legId } = await readyLeg();
    const winner = await makeDriver();
    const other = await makeDriver();
    await offerLegThenExpire(legId);
    expect((await post(winner.cookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(201);

    const lists = await listsFor(other.cookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    expect(idsOf(lists.unclaimed)).not.toContain(legId);
  });

  it('L5 a driver who is no longer eligible -> in NEITHER list, and cannot claim', async () => {
    const { legId } = await readyLeg();
    const driver = await makeDriver();
    await offerLegThenExpire(legId);
    expect(idsOf((await listsFor(driver.cookies)).available)).toContain(legId);

    await ctx.prisma.driverVehicle.update({ where: { id: driver.vehicleId }, data: { approvalStatus: 'REJECTED' } });
    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    expect(idsOf(lists.unclaimed)).not.toContain(legId);
    expect((await post(driver.cookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(400);
  });

  it('L6 the leg leaves READY (cancelled) while visible -> drops out of both, claim refused', async () => {
    const { legId } = await readyLeg();
    const driver = await makeDriver();
    await offerLegThenExpire(legId);
    expect(idsOf((await listsFor(driver.cookies)).unclaimed)).toContain(legId);

    await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    expect(idsOf(lists.unclaimed)).not.toContain(legId);
    expect((await post(driver.cookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(400);
  });

  it('a sender is never offered, never shown and cannot claim their own parcel leg', async () => {
    const { legId, customerUserId } = await readyLeg();
    // The sender is also an approved driver — the same human, two roles, which
    // is exactly the case authorization must judge on the user id.
    await ctx.prisma.userRole.upsert({
      where: { userId_roleCode: { userId: customerUserId, roleCode: 'DELIVERY_DRIVER' } },
      create: { userId: customerUserId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED', approvedAt: new Date() },
    });
    const s = uniq();
    const senderProfile = await ctx.prisma.driverProfile.create({
      data: {
        userId: customerUserId, legalName: 'S Ender', displayName: `Snd${s}`, phone: '+5016000001',
        homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED',
        availability: 'ONLINE', isActive: true,
      },
    });
    await ctx.prisma.driverVehicle.create({
      data: {
        driverProfileId: senderProfile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
        licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
        isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
      },
    });
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: senderProfile.id, district: 'BELIZE', isActive: true } });
    const other = await makeDriver();
    await offerLegThenExpire(legId);

    const senderCookies = await loginAgain((await ctx.prisma.user.findUniqueOrThrow({ where: { id: customerUserId } })).email);
    const lists = await listsFor(senderCookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    expect(idsOf(lists.unclaimed)).not.toContain(legId);
    expect((await post(senderCookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(404);
    // ...and it is still genuinely claimable by somebody who is not the sender.
    expect(idsOf((await listsFor(other.cookies)).unclaimed)).toContain(legId);
  });

  it('an unpaid shipment leg is never claimable, however exhausted it is', async () => {
    const { legId, shipmentId } = await readyLeg();
    await ctx.prisma.shipment.update({ where: { id: shipmentId }, data: { quotedTotalMinor: 5000n } });
    const driver = await makeDriver();
    await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { dispatchExhaustedAt: new Date() } });

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(legId);
    expect(idsOf(lists.unclaimed)).not.toContain(legId);
    expect((await post(driver.cookies, `driver/jobs/legs/${legId}/claim`)).status).toBe(400);
  });
});

/* ------------------------------------------------------------- concurrency */

describe('EDW-P3 concurrency — exactly one winner, no double assignment', () => {
  it('C1 two drivers claiming the same exhausted delivery at once resolve to exactly one winner', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const racers = [await makeDriver(), await makeDriver(), await makeDriver()];
    await offerThenExpire(deliveryId);
    // Every racer sees it in Available (none of them passed).
    for (const r of racers) expect(idsOf((await listsFor(r.cookies)).available)).toContain(deliveryId);

    const probe = await raceOverSeparateConnections(
      ctx.prisma,
      racers.map((r) => () => post(r.cookies, `driver/jobs/${deliveryId}/claim`)),
    );
    const statuses = probe.responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201), `statuses: ${statuses.join(',')}`).toHaveLength(1);
    // Every loser is told the job moved on, not handed a 500 or a silent
    // second assignment.
    expect(statuses.filter((s) => s === 409), `statuses: ${statuses.join(',')}`).toHaveLength(racers.length - 1);
    const after = await deliveryOf(deliveryId);
    expect(after.status).toBe('ASSIGNED');
    expect(racers.map((r) => r.driverProfileId)).toContain(after.assignedDriverProfileId);
    // Exactly one live assignment row — no duplicate driver compensation can
    // follow from a single ACTIVE assignment.
    expect(
      await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' } }),
    ).toBe(1);
  });

  it('C2 two drivers claiming the same exhausted courier leg at once resolve to exactly one winner', async () => {
    const { legId } = await readyLeg();
    const racers = [await makeDriver(), await makeDriver(), await makeDriver()];
    await offerLegThenExpire(legId);

    const probe = await raceOverSeparateConnections(
      ctx.prisma,
      racers.map((r) => () => post(r.cookies, `driver/jobs/legs/${legId}/claim`)),
    );
    const statuses = probe.responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201), `statuses: ${statuses.join(',')}`).toHaveLength(1);
    expect(statuses.filter((s) => s === 409), `statuses: ${statuses.join(',')}`).toHaveLength(racers.length - 1);
    const after = await legOf(legId);
    expect(after.courierStatus).toBe('ASSIGNED');
    expect(racers.map((r) => r.driverProfileId)).toContain(after.assignedDriverProfileId);
    expect(await ctx.prisma.shipmentLegOffer.count({ where: { shipmentLegId: legId, status: 'ACTIVE' } })).toBe(1);
  });

  it('C3 an administrator assigning while a driver claims leaves exactly one owner', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const claimer = await makeDriver();
    const assignee = await makeDriver();
    await offerThenExpire(deliveryId);

    const probe = await raceOverSeparateConnections(ctx.prisma, [
      () => post(claimer.cookies, `driver/jobs/${deliveryId}/claim`),
      () =>
        post(adminCookies, `admin/deliveries/${deliveryId}/assign`, {
          driverProfileId: assignee.driverProfileId,
          vehicleId: assignee.vehicleId,
        }),
    ]);
    const winners = probe.responses.filter((r) => r.status === 201);
    expect(winners, `statuses: ${probe.responses.map((r) => r.status).join(',')}`).toHaveLength(1);
    const after = await deliveryOf(deliveryId);
    expect(after.status).toBe('ASSIGNED');
    expect([claimer.driverProfileId, assignee.driverProfileId]).toContain(after.assignedDriverProfileId);
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' } })).toBe(1);
  });

  it('C4 the same driver retrying their own claim (double tap, network retry) cannot assign it twice', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);

    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(201);
    // The retry is refused rather than quietly creating a second assignment.
    // 404, not 400: once the delivery is ASSIGNED it is outside CLAIM's legal
    // `from` statuses, and the existing existence guard deliberately refuses
    // with a 404 rather than a refusal that names the delivery's current
    // state (SHIP-CLAIM-ROUTE-EXISTENCE-LEAK).
    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(404);
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' } })).toBe(1);
  });

  it('C5 an expired offer arriving late must not strip the driver who claimed in the meantime', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const lapsed = await makeDriver();
    const claimer = await makeDriver();
    await offerThenExpire(deliveryId);
    expect((await post(claimer.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(201);

    // The sweeper runs again, late, still believing it has a lapsed offer from
    // the first driver. It must find nothing to do.
    const swept = await engine.sweepExpiredOffers();
    expect(swept.expired).toBe(0);
    const after = await deliveryOf(deliveryId);
    expect(after.assignedDriverProfileId).toBe(claimer.driverProfileId);
    expect(after.status).toBe('ASSIGNED');
    expect(lapsed.driverProfileId).not.toBe(after.assignedDriverProfileId);
  });

  it('C6 a driver passing after somebody else already has the job cannot take it off them', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const lateDecliner = await makeDriver();
    await enableDispatch({ dispatchMaxOffers: 1 });
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(lateDecliner.driverProfileId);

    // An administrator reassigns to somebody else while the first driver is
    // still looking at their offer. `reassign`, not `assign`: an already
    // ASSIGNED delivery is outside ASSIGN's legal `from` list, which is the
    // state machine working as intended.
    const newOwner = await makeDriver();
    expect(
      (await post(adminCookies, `admin/deliveries/${deliveryId}/reassign`, {
        driverProfileId: newOwner.driverProfileId,
        vehicleId: newOwner.vehicleId,
        reason: 'Driver not responding',
      })).status,
    ).toBe(201);

    // The stale decline is refused, and the new owner keeps the job.
    const declined = await post(lateDecliner.cookies, `driver/jobs/${deliveryId}/decline`, { reason: 'Too late' });
    expect([403, 404, 409]).toContain(declined.status);
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(newOwner.driverProfileId);
  });

  it('C7 an authorized reassignment after a claim moves the job and returns nothing to the pool twice', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const claimer = await makeDriver();
    const replacement = await makeDriver();
    await offerThenExpire(deliveryId);
    expect((await post(claimer.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(201);
    expect((await post(claimer.cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(201);

    expect(
      (await post(adminCookies, `admin/deliveries/${deliveryId}/reassign`, {
        driverProfileId: replacement.driverProfileId,
        vehicleId: replacement.vehicleId,
        reason: 'Driver unreachable',
      })).status,
    ).toBe(201);
    const after = await deliveryOf(deliveryId);
    expect(after.assignedDriverProfileId).toBe(replacement.driverProfileId);
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' } })).toBe(1);
    // A reassignment is not a refusal by the driver who lost it. Ordered
    // newest-first on purpose: this driver may also hold an earlier EXPIRED
    // row for the same delivery (the lapsed offer that made it claimable),
    // and the row under test here is the one the reassignment just ended.
    const superseded = await ctx.prisma.deliveryAssignment.findFirstOrThrow({
      where: { orderDeliveryId: deliveryId, driverProfileId: claimer.driverProfileId },
      orderBy: { assignedAt: 'desc' },
    });
    expect(superseded.status).toBe('REASSIGNED');
    expect(superseded.resolution).toBeNull();
  });

  it('C8 the lists are stored state, not session state: a second login sees exactly the same two lists', async () => {
    // Covers logout/login, a refresh, a reconnection and a second tab or
    // device in one assertion: nothing about either list is derived from the
    // session, so a different session for the same driver must agree.
    const vendor = await makeVendor();
    const passed = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExplicitPass(passed.deliveryId, driver);

    const first = await listsFor(driver.cookies);
    const secondSession = await loginAgain(driver.email);
    const second = await listsFor(secondSession);
    expect(idsOf(second.available)).toEqual(idsOf(first.available));
    expect(idsOf(second.unclaimed)).toEqual(idsOf(first.unclaimed));
    expect(second.unclaimed.find((j) => j.id === passed.deliveryId)!.claim.youPassed).toBe(true);
  });

  it('C10 one driver claiming from Available while a driver who PASSED claims from Unclaimed resolves to one winner, loser 409', async () => {
    // The two lists are different lists with different membership rules, and
    // this is the case where that matters most: the Available claimer never
    // passed, the Unclaimed claimer did, and both are legitimately allowed to
    // take the job. Exactly one may.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const lapsed = await makeDriver();
    const passer = await makeDriver({ availability: 'OFFLINE' });
    await enableDispatch({ dispatchMaxOffers: 3 });

    // 1. Offered to `lapsed`, who never answers.
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(lapsed.driverProfileId);
    // Parked before the sweep so the sweeper's own re-offer finds nobody —
    // this test needs to choose who is asked next, which real dispatch
    // deliberately does not let a caller do.
    await ctx.prisma.driverProfile.update({ where: { id: lapsed.driverProfileId }, data: { availability: 'OFFLINE' } });
    await ctx.prisma.orderDelivery.update({ where: { id: deliveryId }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    expect((await engine.sweepExpiredOffers()).expired).toBe(1);

    // 2. Offered to `passer`, who explicitly says no.
    await ctx.prisma.driverProfile.update({ where: { id: passer.driverProfileId }, data: { availability: 'ONLINE' } });
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(passer.driverProfileId);
    await ctx.prisma.driverProfile.update({ where: { id: passer.driverProfileId }, data: { availability: 'OFFLINE' } });
    expect((await post(passer.cookies, `driver/jobs/${deliveryId}/decline`, { reason: 'Not tonight' })).status).toBe(201);

    // 3. The rotation is spent.
    await enableDispatch({ dispatchMaxOffers: 1 });
    expect((await engine.dispatch(deliveryId)).result).toBe('EXHAUSTED');
    await ctx.prisma.driverProfile.updateMany({
      where: { id: { in: [lapsed.driverProfileId, passer.driverProfileId] } },
      data: { availability: 'ONLINE' },
    });

    // Each driver's lists are what the matrix says they should be.
    const lapsedLists = await listsFor(lapsed.cookies);
    const passerLists = await listsFor(passer.cookies);
    expect(idsOf(lapsedLists.available)).toContain(deliveryId);
    expect(idsOf(passerLists.available)).not.toContain(deliveryId);
    const fromAvailable = lapsedLists.available.find((j) => j.id === deliveryId)!.claim!;
    const fromUnclaimed = passerLists.unclaimed.find((j) => j.id === deliveryId)!.claim;
    expect(fromAvailable.youPassed).toBe(false);
    expect(fromUnclaimed.youPassed).toBe(true);
    // Both lists hand out the same claim route — the server does not offer the
    // two of them different ways in.
    expect(fromUnclaimed.claimPath).toBe(fromAvailable.claimPath);

    const probe = await raceOverSeparateConnections(ctx.prisma, [
      () => post(lapsed.cookies, fromAvailable.claimPath),
      () => post(passer.cookies, fromUnclaimed.claimPath),
    ]);
    const statuses = probe.responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201), `statuses: ${statuses.join(',')}`).toHaveLength(1);
    expect(statuses.filter((s) => s === 409), `statuses: ${statuses.join(',')}`).toHaveLength(1);
    const after = await deliveryOf(deliveryId);
    expect([lapsed.driverProfileId, passer.driverProfileId]).toContain(after.assignedDriverProfileId);
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId, status: 'ACTIVE' } })).toBe(1);
  });

  it('C9 at the concurrent-job cap both lists are empty rather than offering work no claim would accept', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();
    await offerThenExpire(deliveryId);
    expect(idsOf((await listsFor(driver.cookies)).available)).toContain(deliveryId);

    await enableDispatch({ dispatchMaxConcurrentPerDriver: 1 });
    const busy = await readyDelivery(vendor);
    await ctx.prisma.orderDelivery.update({
      where: { id: busy.deliveryId },
      data: { status: 'DRIVER_ACCEPTED', assignedDriverProfileId: driver.driverProfileId, acceptedAt: new Date() },
    });

    const lists = await listsFor(driver.cookies);
    expect(idsOf(lists.available)).not.toContain(deliveryId);
    expect(idsOf(lists.unclaimed)).not.toContain(deliveryId);
    expect((await post(driver.cookies, `driver/jobs/${deliveryId}/claim`)).status).toBe(400);
  });
});
