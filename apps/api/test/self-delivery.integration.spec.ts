/**
 * Nobody delivers their own order.
 *
 * A person may legitimately hold both CUSTOMER and DELIVERY_DRIVER — plenty of
 * couriers buy things. What they may not do is take the job for the order they
 * themselves placed: they would be the only party in the chain, confirming their
 * own collection, marking their own parcel delivered against a PIN they were
 * shown, and earning the delivery fee out of the payment they just made.
 *
 * These tests cover both halves of the rule, because only proving the refusal
 * would leave "dispatch is broken" and "dispatch is safe" looking identical. The
 * last test in each group is the one that proves the platform still works.
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
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
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
    data: {
      vendorProfileId: vp.id, categoryId, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU-${s}`,
      status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD',
      inventory: { create: { quantity: 10, reserved: 0 } },
    },
  });
  return { vendorProfileId: vp.id, productId: product.id };
}

/** Give an EXISTING user an approved, online driver profile. */
async function makeDriverFor(userId: string, district = 'BELIZE') {
  const s = uniq();
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: district as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
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
  return { driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** A fresh user who is ONLY a driver. */
async function makeSeparateDriver(district = 'BELIZE') {
  const s = uniq();
  const { cookies, userId } = await registerUser(`drv_${s}@example.bz`);
  const d = await makeDriverFor(userId, district);
  return { cookies, userId, ...d };
}

/** A ready-to-dispatch delivery placed by `customerId`. */
async function readyDelivery(vendor: { vendorProfileId: string; productId: string }, customerId: string, district = 'BELIZE') {
  const s = uniq();
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num, userId: customerId, status: 'PENDING',
      itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n,
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', addressLine1: '5 Ave', city: 'Town', district: district as never } },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`, vendorProfileId: vendor.vendorProfileId,
          status: 'READY_FOR_PICKUP', readyForPickupAt: new Date(), deliveryMethod: 'DELIVERY',
          itemCount: 1, subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n, readyForDispatchAt: new Date() } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return order.vendorOrders[0]!.delivery!.id;
}

async function enableDispatch() {
  const data = {
    dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90,
    dispatchMaxOffers: 5, dispatchMaxConcurrentPerDriver: 3,
  };
  const existing = await ctx.prisma.platformSetting.findFirst();
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}` } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
});
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => { await enableDispatch(); });

describe('marketplace — the customer is never the driver', () => {
  it('A · offers the job to the other driver, not to the customer who is also a driver', async () => {
    const vendor = await makeVendor();
    const { userId: customerId } = await registerUser(`multi_${uniq()}@example.bz`);
    const D = 'BELIZE';
    const own = await makeDriverFor(customerId, D);        // customer is a driver too
    const other = await makeSeparateDriver(D);            // and somebody else is available
    const deliveryId = await readyDelivery(vendor, customerId, D);

    const res = await engine.dispatch(deliveryId);
    expect(res.result).toBe('ASSIGNED');

    const d = await deliveryOf(deliveryId);
    expect(d.assignedDriverProfileId).toBe(other.driverProfileId);
    expect(d.assignedDriverProfileId).not.toBe(own.driverProfileId);

    // And no trace of the customer in the offer history.
    const offered = await ctx.prisma.deliveryAssignment.findMany({ where: { orderDeliveryId: deliveryId } });
    expect(offered.map((a) => a.driverProfileId)).not.toContain(own.driverProfileId);
  });

  it('B · finds nobody rather than falling back to the customer when they are the only driver', async () => {
    const vendor = await makeVendor();
    const { cookies, userId: customerId } = await registerUser(`only_${uniq()}@example.bz`);
    const D = 'CAYO';
    const own = await makeDriverFor(customerId, D);
    const deliveryId = await readyDelivery(vendor, customerId, D);

    const res = await engine.dispatch(deliveryId);
    expect(res.result).toBe('NO_CANDIDATES');

    const d = await deliveryOf(deliveryId);
    expect(d.assignedDriverProfileId).toBeNull();
    expect(d.status).toBe('PENDING_ASSIGNMENT');

    // Nothing offered, nothing visible, nothing earned.
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderDeliveryId: deliveryId } })).toBe(0);
    const feed = await get(cookies, 'driver/jobs?scope=available');
    expect(feed.status).toBe(200);
    expect(JSON.stringify(feed.body)).not.toContain(deliveryId);
    expect(await ctx.prisma.driverEarning.count({ where: { driverProfileId: own.driverProfileId } })).toBe(0);
  });

  it('C · refuses a direct accept of your own delivery, even knowing its id', async () => {
    const vendor = await makeVendor();
    const { cookies, userId: customerId } = await registerUser(`direct_${uniq()}@example.bz`);
    const D = 'COROZAL';
    await makeDriverFor(customerId, D);
    const deliveryId = await readyDelivery(vendor, customerId, D);

    // Unassigned, the ownership check alone already answers 404.
    expect((await get(cookies, `driver/jobs/${deliveryId}`)).status).toBe(404);
    expect((await post(cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(404);

    // Now the case ownership does NOT cover: the delivery really is assigned to
    // the customer's own driver profile. This is what a row left behind by a
    // bug, a bad backfill, or a future code path that forgets the rule would
    // look like — the point of the second lock is that such a row is still not
    // workable. Written directly because no supported path can produce it.
    const own = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { userId: customerId } });
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { status: 'ASSIGNED', assignedDriverProfileId: own.id, assignedAt: new Date(), pickupPin: '123456', deliveryPin: '654321' },
    });

    expect((await get(cookies, `driver/jobs/${deliveryId}`)).status).toBe(404);
    expect((await post(cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(404);
    // The PINs that would let them sign for their own parcel stay out of reach.
    expect((await post(cookies, `driver/jobs/${deliveryId}/confirm-pickup`, { pin: '123456' })).status).toBe(404);
    expect((await post(cookies, `driver/jobs/${deliveryId}/confirm-delivery`, { pin: '654321', recipientName: 'Me' })).status).toBe(404);

    // Not in any of their driver views either.
    for (const scope of ['available', 'assigned', 'active']) {
      const feed = await get(cookies, `driver/jobs?scope=${scope}`);
      expect(JSON.stringify(feed.body)).not.toContain(deliveryId);
    }
    const counts = await get(cookies, 'driver/jobs/counts');
    expect(counts.body).toMatchObject({ available: 0, assigned: 0, active: 0 });

    // And it never became a delivered job or an earning.
    const after = await deliveryOf(deliveryId);
    expect(after.status).toBe('ASSIGNED');
    expect(after.deliveredAt).toBeNull();
    expect(await ctx.prisma.driverEarning.count({ where: { driverProfileId: own.id } })).toBe(0);
  });

  it('D · refuses an administrator assigning the customer to their own delivery', async () => {
    const vendor = await makeVendor();
    const { userId: customerId } = await registerUser(`adminassign_${uniq()}@example.bz`);
    const D = 'ORANGE_WALK';
    const own = await makeDriverFor(customerId, D);
    const deliveryId = await readyDelivery(vendor, customerId, D);

    const res = await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, {
      driverProfileId: own.driverProfileId,
      vehicleId: own.vehicleId,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/own delivery/i);

    // The admin's eligible list should not have offered them in the first place.
    const list = await get(adminCookies, `admin/deliveries/${deliveryId}/eligible-drivers`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(own.driverProfileId);

    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBeNull();
  });

  it('E · the re-offer path after a decline still will not fall back to the customer', async () => {
    const vendor = await makeVendor();
    const { userId: customerId } = await registerUser(`declined_${uniq()}@example.bz`);
    const D = 'STANN_CREEK';
    const own = await makeDriverFor(customerId, D);
    const deliveryId = await readyDelivery(vendor, customerId, D);

    // Enter dispatch through the re-offer branch rather than the first-offer
    // one. Declining for real here would race the immediate re-dispatch that a
    // decline kicks off, so the state a decline leaves behind is set directly:
    // what is under test is that DRIVER_DECLINED does not widen the candidate
    // pool, not the decline endpoint itself (covered by the dispatch suite).
    await ctx.prisma.orderDelivery.update({
      where: { id: deliveryId },
      data: { status: 'DRIVER_DECLINED', declinedAt: new Date(), declineReason: 'Too far', offerCount: 1 },
    });

    const again = await engine.dispatch(deliveryId);
    expect(again.result).toBe('NO_CANDIDATES');

    const d = await deliveryOf(deliveryId);
    expect(d.assignedDriverProfileId).toBeNull();
    const history = await ctx.prisma.deliveryAssignment.findMany({ where: { orderDeliveryId: deliveryId } });
    expect(history.map((a) => a.driverProfileId)).not.toContain(own.driverProfileId);

    // And an administrator cannot reach the same end by reassigning by hand.
    const forced = await post(adminCookies, `admin/deliveries/${deliveryId}/reassign`, {
      driverProfileId: own.driverProfileId,
      vehicleId: own.vehicleId,
      reason: 'Nobody else available',
    });
    expect(forced.status).toBe(400);
    expect(String(forced.body.message)).toMatch(/own delivery/i);
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBeNull();
  });

  it('F · a separate driver still receives, accepts and completes the delivery', async () => {
    const vendor = await makeVendor();
    const { userId: customerId } = await registerUser(`positive_${uniq()}@example.bz`);
    const D = 'TOLEDO';
    await makeDriverFor(customerId, D);            // customer is a driver, and stays excluded
    const other = await makeSeparateDriver(D);
    const deliveryId = await readyDelivery(vendor, customerId, D);

    expect((await engine.dispatch(deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(other.driverProfileId);

    // The separate driver can see it and work it.
    expect((await get(other.cookies, `driver/jobs/${deliveryId}`)).status).toBe(200);
    expect((await post(other.cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(201);
    expect((await deliveryOf(deliveryId)).status).toBe('DRIVER_ACCEPTED');

    const withPins = await deliveryOf(deliveryId);
    expect((await post(other.cookies, `driver/jobs/${deliveryId}/confirm-pickup`, { pin: withPins.pickupPin })).status).toBe(201);
    expect((await deliveryOf(deliveryId)).status).toBe('PICKUP_CONFIRMED');

    expect((await post(other.cookies, `driver/jobs/${deliveryId}/in-transit`)).status).toBe(201);
    expect((await post(other.cookies, `driver/jobs/${deliveryId}/arriving`)).status).toBe(201);
    const delivered = await post(other.cookies, `driver/jobs/${deliveryId}/confirm-delivery`, {
      pin: withPins.deliveryPin,
      recipientName: 'Cust Omer',
    });
    expect(delivered.status).toBe(201);

    const final = await deliveryOf(deliveryId);
    expect(final.status).toBe('DELIVERED');
    expect(final.deliveredAt).toBeTruthy();
    expect(final.assignedDriverProfileId).toBe(other.driverProfileId);
  });
});
