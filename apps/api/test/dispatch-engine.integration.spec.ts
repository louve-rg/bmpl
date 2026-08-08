/**
 * Automatic dispatch (M26.3 · Part 4) — integration vs real Postgres.
 *
 * These scenarios cannot be verified in production. Dispatch is designed to find
 * the best eligible driver, so on a live platform it correctly selects REAL
 * drivers who happen to be online — which happened twice during production
 * verification. Isolated data plus a real database is the only place the offer,
 * timeout, re-offer and concurrent-acceptance paths can be exercised honestly.
 *
 * The engine is driven directly rather than through the 20-second sweeper: a test
 * that sleeps for real timeouts is slow and flaky, and the sweeper's only job is
 * to call these same methods on a timer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { DispatchEngineService } from '../src/dispatch/dispatch-engine.service';

let ctx: TestContext;
let engine: DispatchEngineService;
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

const post = (c: string[], p: string, b: unknown = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

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
  const { userId } = await registerCustomer(`vend_${s}@example.bz`);
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

/**
 * A delivery the vendor HAS marked ready — the only kind the engine may offer.
 * `ready: false` produces the unreadied case that a bad migration once made
 * dispatchable, so the guard against it stays covered.
 */
async function readyDelivery(
  vendor: { vendorProfileId: string; productId: string },
  opts: { district?: string; ready?: boolean } = {},
) {
  const district = opts.district ?? 'BELIZE';
  const ready = opts.ready ?? true;
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
          status: ready ? 'READY_FOR_PICKUP' : 'PENDING',
          readyForPickupAt: ready ? new Date() : null,
          deliveryMethod: 'DELIVERY',
          itemCount: 1,
          subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: {
            create: {
              status: 'PENDING_ASSIGNMENT',
              feeMinor: 500n,
              readyForDispatchAt: ready ? new Date() : null,
            },
          },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return { deliveryId: order.vendorOrders[0]!.delivery!.id, customerId };
}

async function makeDriver(
  opts: {
    availability?: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE';
    licenceExpiry?: Date;
    registrationExpiry?: Date;
    insuranceExpiry?: Date;
    vehicleApproval?: 'PENDING' | 'APPROVED' | 'REJECTED';
    vehicleActive?: boolean;
    districts?: string[];
    roleStatus?: 'PENDING' | 'APPROVED' | 'SUSPENDED';
  } = {},
) {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: opts.roleStatus ?? 'APPROVED', approvedAt: new Date() },
    update: { status: opts.roleStatus ?? 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Drv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `DL-${s}`,
      licenceExpiry: opts.licenceExpiry ?? FUTURE,
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
      registrationExpiry: opts.registrationExpiry ?? FUTURE,
      insuranceExpiry: opts.insuranceExpiry ?? FUTURE,
      isActive: opts.vehicleActive ?? true,
      isPrimary: true,
      approvalStatus: opts.vehicleApproval ?? 'APPROVED',
    },
  });
  for (const d of opts.districts ?? ['BELIZE']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Turn automatic dispatch on for a test. Production default is OFF. */
async function enableDispatch(over: Record<string, unknown> = {}) {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, ...over };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  // A super admin must exist for the app to behave normally, but these tests
  // drive the engine and driver endpoints directly — no admin session needed.
  await seedSuperAdmin(ctx.prisma);
  const cat = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}`, isActive: true } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await enableDispatch();
});

describe('automatic dispatch — gating', () => {
  it('does not offer a delivery the vendor has not marked ready', async () => {
    // The exact defect that offered a live order to a test driver in production:
    // an unreadied delivery must never reach a driver, however eligible they are.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { ready: false });
    await makeDriver();

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('SKIPPED');
    expect((await deliveryOf(deliveryId)).status).toBe('PENDING_ASSIGNMENT');
  });

  it('does nothing at all when automatic dispatch is switched off', async () => {
    await enableDispatch({ dispatchAutomatic: false });
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();

    expect((await engine.dispatch(deliveryId)).result).toBe('SKIPPED');
    expect((await deliveryOf(deliveryId)).status).toBe('PENDING_ASSIGNMENT');
  });

  it('offers a ready delivery to an eligible driver', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const driver = await makeDriver();

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('ASSIGNED');

    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(d.offerCount).toBe(1);
    expect(d.offerExpiresAt).not.toBeNull();
    // A system assignment leaves no human actor — that is what distinguishes it
    // from an admin assignment in the audit trail.
    expect(d.assignedByUserId).toBeNull();
  });
});

describe('automatic dispatch — eligibility filtering (D/E/F/G)', () => {
  // Each case makes exactly ONE thing wrong, so a failure names its own cause.
  const ineligible: Array<[string, Parameters<typeof makeDriver>[0]]> = [
    ['D: driver is offline', { availability: 'OFFLINE' }],
    ['D: driver is unavailable', { availability: 'UNAVAILABLE' }],
    ['E: vehicle awaiting approval', { vehicleApproval: 'PENDING' }],
    ['E: vehicle rejected', { vehicleApproval: 'REJECTED' }],
    ['E: vehicle inactive', { vehicleActive: false }],
    ['F: licence expired', { licenceExpiry: PAST }],
    ['F: registration expired', { registrationExpiry: PAST }],
    ['F: insurance expired', { insuranceExpiry: PAST }],
    ['G: does not serve the delivery district', { districts: ['CAYO'] }],
    ['role not approved', { roleStatus: 'PENDING' }],
    ['role suspended', { roleStatus: 'SUSPENDED' }],
  ];

  it.each(ineligible)('skips a driver when %s', async (_label, driverOpts) => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE' });
    await makeDriver(driverOpts);

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('NO_CANDIDATES');
    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('PENDING_ASSIGNMENT');
    expect(d.assignedDriverProfileId).toBeNull();
  });

  it('G: picks the driver up again the moment the district is added back', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE' });
    const driver = await makeDriver({ districts: ['CAYO'] });

    expect((await engine.dispatch(deliveryId)).result).toBe('NO_CANDIDATES');

    // No logout, no restart — eligibility is derived live on every read.
    await ctx.prisma.driverServiceArea.create({
      data: { driverProfileId: driver.driverProfileId, district: 'BELIZE', isActive: true },
    });

    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('respects the per-driver concurrency cap', async () => {
    const vendor = await makeVendor();
    const driver = await makeDriver();
    await enableDispatch({ dispatchMaxConcurrentPerDriver: 1 });

    const first = await readyDelivery(vendor);
    expect((await engine.dispatch(first.deliveryId)).result).toBe('ASSIGNED');

    // Already holding one job, and the cap is one.
    const second = await readyDelivery(vendor);
    expect((await engine.dispatch(second.deliveryId)).result).toBe('NO_CANDIDATES');
    void driver;
  });
});

describe('automatic dispatch — C: timeout and re-offer', () => {
  it('expires an ignored offer and passes it to the next driver', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();

    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(a.driverProfileId);

    // A second driver must exist BEFORE the sweep, or there is nobody to hand to.
    const b = await makeDriver();

    // Wind the clock rather than sleeping: the sweeper selects on offerExpiresAt,
    // so an expiry in the past is indistinguishable from one that has just lapsed.
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });

    const swept = await engine.sweepExpiredOffers();
    expect(swept.expired).toBe(1);
    expect(swept.reassigned).toBe(1);

    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.assignedDriverProfileId).toBe(b.driverProfileId);
    expect(d.offerCount).toBe(2);

    // Exactly one live assignment; driver A's is closed, not deleted.
    const assignments = await ctx.prisma.deliveryAssignment.findMany({ where: { orderDeliveryId: deliveryId } });
    expect(assignments).toHaveLength(2);
    expect(assignments.filter((x) => x.status === 'ACTIVE')).toHaveLength(1);
    expect(assignments.find((x) => x.driverProfileId === a.driverProfileId)!.status).toBe('DECLINED');

    // The expiry is on the record, not just implied by the new assignment.
    const timeline = await ctx.prisma.deliveryTimelineEvent.findMany({ where: { orderDeliveryId: deliveryId } });
    expect(timeline.some((t) => t.event === 'OFFER_EXPIRED')).toBe(true);
  });

  it('leaves an ACCEPTED job alone even if its offer timer has lapsed', async () => {
    // The driver got there first. Expiring their job out from under them would
    // hand a delivery someone is already collecting to a second driver.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');

    await post(a.cookies, `driver/jobs/${deliveryId}/accept`).expect(201);
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });

    const swept = await engine.sweepExpiredOffers();
    expect(swept.expired).toBe(0);
    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('DRIVER_ACCEPTED');
    expect(d.assignedDriverProfileId).toBe(a.driverProfileId);
  });

  it('I: escalates once the retry budget is spent, without inventing an assignment', async () => {
    await enableDispatch({ dispatchMaxOffers: 1 });
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    await makeDriver();

    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });
    await engine.sweepExpiredOffers();

    const d = await deliveryOf(deliveryId);
    expect(d.dispatchExhaustedAt).not.toBeNull();
    // Safe, visible, and still unassigned — never silently dropped.
    expect(d.assignedDriverProfileId).toBeNull();
    expect(['PENDING_ASSIGNMENT', 'DRIVER_DECLINED']).toContain(d.status);
  });
});

describe('automatic dispatch — B: decline', () => {
  it('closes the declining driver out and re-offers to the next', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');

    const b = await makeDriver();
    await post(a.cookies, `driver/jobs/${deliveryId}/decline`, { reason: 'too far' }).expect(201);

    // decline re-offers synchronously, so B should already hold it.
    const d = await deliveryOf(deliveryId);
    expect(d.assignedDriverProfileId).toBe(b.driverProfileId);

    // A can no longer act on it.
    await post(a.cookies, `driver/jobs/${deliveryId}/accept`).expect(404);
  });
});

describe('automatic dispatch — H: concurrent acceptance', () => {
  it('lets exactly one of two simultaneous accepts win', async () => {
    // The race the conditional write exists for. Both requests are fired without
    // awaiting in between so they overlap inside Postgres; the loser must get a
    // clean conflict, not a corrupted delivery.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');

    const [first, second] = await Promise.all([
      post(a.cookies, `driver/jobs/${deliveryId}/accept`),
      post(a.cookies, `driver/jobs/${deliveryId}/accept`),
    ]);

    const codes = [first.status, second.status].sort();
    // One accept (201). The other is either the idempotent replay (201/200) or a
    // conflict (409) depending on interleaving — what must NOT happen is a 500 or
    // a second acceptance being recorded.
    expect(codes.every((c) => [200, 201, 409].includes(c))).toBe(true);

    const d = await deliveryOf(deliveryId);
    expect(d.status).toBe('DRIVER_ACCEPTED');
    expect(d.assignedDriverProfileId).toBe(a.driverProfileId);

    const accepted = await ctx.prisma.deliveryAssignment.findMany({
      where: { orderDeliveryId: deliveryId, status: 'ACCEPTED' },
    });
    expect(accepted).toHaveLength(1);

    const acceptEvents = await ctx.prisma.deliveryTimelineEvent.findMany({
      where: { orderDeliveryId: deliveryId, event: 'ACCEPT' },
    });
    expect(acceptEvents).toHaveLength(1);
  });

  it('refuses acceptance from a driver the job was already taken from', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');

    const b = await makeDriver();
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });
    await engine.sweepExpiredOffers();
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(b.driverProfileId);

    // A is no longer the assignee — 404, so A cannot even probe the job's state.
    await post(a.cookies, `driver/jobs/${deliveryId}/accept`).expect(404);
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(b.driverProfileId);
  });
});

describe('automatic dispatch — earnings safety', () => {
  it('creates no driver earning for a delivery with no authorized payment', async () => {
    // Matches what production showed: escrow gates earnings, and the absence of
    // an earning on an unpaid order is correct rather than a missing feature.
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor);
    const a = await makeDriver();
    await engine.dispatch(deliveryId);
    await post(a.cookies, `driver/jobs/${deliveryId}/accept`).expect(201);

    const earnings = await ctx.prisma.driverEarning.findMany({
      where: { driverProfileId: a.driverProfileId },
    });
    expect(earnings).toHaveLength(0);
  });
});
