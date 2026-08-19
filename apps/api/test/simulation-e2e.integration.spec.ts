/**
 * The REAL customer → vendor → dispatch → driver chain, plus the boundary that
 * keeps a rehearsal off a real driver — integration vs real Postgres.
 *
 * The previous attempt at this proved nothing, because it inserted an
 * already-assigned delivery straight into the database and handed it to a
 * driver. That skipped checkout, vendor fulfilment and dispatch, which is most
 * of what could actually be broken. This suite places the order through
 * `POST /checkout` exactly as the browser does, marks it ready through the
 * vendor's own endpoint, and lets the dispatch engine choose the driver.
 *
 * The isolation it asserts is symmetric and server-side:
 *   a simulation delivery reaches ONLY a designated test driver,
 *   and a real delivery NEVER reaches one.
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

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** A real Belize doorstep — Ladyville. */
const PIN = { latitude: 17.5667, longitude: -88.2833 };

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** A storefront with a published, in-stock, delivery-enabled product. */
async function makeVendor(opts: { isTest?: boolean } = {}) {
  const s = uniq();
  const { userId } = await registerCustomer(`sv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      isTest: opts.isTest ?? false,
      businessName: `${opts.isTest ? 'TEST ' : ''}Store ${s}`,
      slug: `sim-store-${s}`,
      contactEmail: `sv${s}@example.com`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: {
        create: {
          label: 'Main',
          addressLine1: '12 Freetown Road',
          city: 'Belize City',
          district: 'BELIZE',
          latitude: 17.4995,
          longitude: -88.1976,
          isPrimary: true,
        },
      },
    },
  });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id,
      categoryId,
      title: `${opts.isTest ? 'TEST ' : ''}Product ${s}`,
      slug: `sim-prod-${s}`,
      sku: `SIM-${s}`,
      status: 'PUBLISHED',
      priceMinor: 2500n,
      currency: 'BZD',
      inventory: { create: { quantity: 100, reserved: 0 } },
    },
  });
  return { vendorProfileId: vp.id, vendorUserId: userId, productId: product.id };
}

async function makeDriver(opts: { isTest?: boolean } = {}) {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`sd_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      isTest: opts.isTest ?? false,
      legalName: 'D River',
      displayName: `${opts.isTest ? 'TEST ' : ''}Drv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `SDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR',
      make: 'Toyota',
      model: 'Corolla',
      licencePlate: `SZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE,
      insuranceExpiry: FUTURE,
      isActive: true,
      isPrimary: true,
      approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: profile.id };
}

/** Place an order the way the browser does: add to cart, then POST /checkout. */
async function placeOrder(
  customer: { cookies: string[] },
  vendor: { vendorProfileId: string; productId: string },
  opts: { pin?: { latitude: number; longitude: number } | null; instructions?: string } = {},
) {
  const add = await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 });
  expect(add.status).toBe(201);

  const body = {
    vendors: [
      {
        vendorProfileId: vendor.vendorProfileId,
        deliveryMethod: 'DELIVERY',
        deliveryInstructions: opts.instructions,
      },
    ],
    deliveryAddress: {
      fullName: 'Aurelia Pennyworth',
      phone: '+5010001111',
      addressLine1: '4 Vista Del Mar',
      city: 'Ladyville',
      district: 'BELIZE',
      ...(opts.pin === null ? {} : { latitude: (opts.pin ?? PIN).latitude, longitude: (opts.pin ?? PIN).longitude }),
    },
  };
  return post(customer.cookies, 'checkout', body);
}

const deliveryOfOrder = (orderId: string) =>
  ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId } } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: 'Sim', slug: `sim-${uniq()}` } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
});
afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 5, dispatchMaxConcurrentPerDriver: 3 };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
  // Only the drivers a test creates itself may be candidates.
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

/* ================== THE CHAIN, THROUGH THE REAL ENDPOINTS ================= */

describe('customer → vendor → dispatch → driver, end to end', () => {
  it('carries a map pin from checkout all the way to the driver’s navigation link', async () => {
    const vendor = await makeVendor({ isTest: true });
    const driver = await makeDriver({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);

    // 1. CUSTOMER places the order through the real checkout.
    const placed = await placeOrder(customer, vendor, { instructions: 'Blue gate, second house past the bridge.' });
    expect(placed.status).toBe(201);
    const orderId = placed.body.id;

    // Derived from the storefront, never from the request body.
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.isTest).toBe(true);

    // The pin is snapshotted onto THIS order's address.
    const address = await ctx.prisma.orderAddress.findFirstOrThrow({ where: { orderId } });
    expect(address.latitude).toBeCloseTo(PIN.latitude, 6);
    expect(address.longitude).toBeCloseTo(PIN.longitude, 6);

    // 2. Nothing is dispatchable yet — the vendor has not packed it.
    const delivery = await deliveryOfOrder(orderId);
    expect(delivery.status).toBe('PENDING_ASSIGNMENT');
    expect(delivery.readyForDispatchAt).toBeNull();
    expect((await engine.dispatch(delivery.id)).result).toBe('SKIPPED');

    // 3. VENDOR fulfils through their own endpoints, signed in as themselves.
    const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId } });
    const vendorUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: vendor.vendorUserId } });
    const vLogin = await request(ctx.server).post('/api/auth/login').send({ email: vendorUser.email, password: 'CustomerPass123' });
    expect(vLogin.status).toBe(201);
    const vCookies = cookiesOf(vLogin);

    expect((await post(vCookies, `vendor/orders/${vo.id}/start-preparing`)).status).toBe(201);
    expect((await ctx.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vo.id } })).status).toBe('PREPARING');

    // Marking ready is what makes it dispatchable AND triggers the engine.
    expect((await post(vCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);

    // 4. DISPATCH offered it to the test driver, with no manual assignment.
    const offered = await deliveryOfOrder(orderId);
    expect(offered.readyForDispatchAt).not.toBeNull();
    expect(offered.status).toBe('ASSIGNED');
    expect(offered.assignedDriverProfileId).toBe(driver.driverProfileId);

    // 5. DRIVER sees it under Available, WITHOUT the customer's details.
    const available = await get(driver.cookies, 'driver/jobs?scope=available');
    expect(available.body.map((j: { id: string }) => j.id)).toContain(offered.id);
    const beforeAccept = await get(driver.cookies, `driver/jobs/${offered.id}`);
    expect(beforeAccept.body.addressUnlocked).toBe(false);
    expect(beforeAccept.body.pinnedLocation).toBeNull();
    expect(beforeAccept.body.navigationUrl).toBeNull();
    expect(beforeAccept.body.deliveryInstructions).toBeNull();
    expect(JSON.stringify(beforeAccept.body)).not.toContain('Aurelia Pennyworth');
    expect(JSON.stringify(beforeAccept.body)).not.toContain(String(PIN.latitude));

    // 6. ACCEPT unlocks the pin, the instructions and the navigation link.
    expect((await post(driver.cookies, `driver/jobs/${offered.id}/accept`)).status).toBe(201);
    const afterAccept = await get(driver.cookies, `driver/jobs/${offered.id}`);
    expect(afterAccept.body.addressUnlocked).toBe(true);
    expect(afterAccept.body.pinnedLocation).toEqual({ latitude: PIN.latitude, longitude: PIN.longitude });
    expect(afterAccept.body.deliveryInstructions).toBe('Blue gate, second house past the bridge.');
    expect(afterAccept.body.navigationUrl).toContain('google.com/maps');
    expect(afterAccept.body.navigationUrl).not.toMatch(/key=|apiKey/); // keyless by design
    expect(afterAccept.body.isTest).toBe(true);

    // 7. Run the delivery to completion on the real endpoints.
    const pins = await ctx.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: offered.id },
      select: { pickupPin: true, deliveryPin: true },
    });
    expect((await post(driver.cookies, `driver/jobs/${offered.id}/confirm-pickup`, { pin: pins.pickupPin })).status).toBe(201);
    expect((await post(driver.cookies, `driver/jobs/${offered.id}/in-transit`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/jobs/${offered.id}/arriving`)).status).toBe(201);
    expect(
      (await post(driver.cookies, `driver/jobs/${offered.id}/confirm-delivery`, { pin: pins.deliveryPin, recipientName: 'Aurelia' })).status,
    ).toBe(201);
    expect((await deliveryOfOrder(orderId)).status).toBe('DELIVERED');

    // 8. CUSTOMER can track it, and sees the driver + vehicle.
    const tracked = await get(customer.cookies, `deliveries/${offered.id}`);
    expect(tracked.status).toBe(200);
    expect(tracked.body.driver?.displayName).toBeTruthy();
    expect(tracked.body.vehicle?.licencePlate).toBeTruthy();
    expect(tracked.body.progress?.length).toBeGreaterThan(0);

    // 9. No money moved, and the figures are untouched.
    expect(await ctx.prisma.driverEarning.count()).toBe(0);
    expect(await ctx.prisma.vendorSettlement.count({ where: { status: 'POSTED' } })).toBe(0);
  });

  it('will not dispatch before the vendor marks it ready', async () => {
    const vendor = await makeVendor({ isTest: true });
    await makeDriver({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor);
    const delivery = await deliveryOfOrder(placed.body.id);

    expect((await engine.dispatch(delivery.id)).result).toBe('SKIPPED');
    await engine.sweepUndispatched();
    expect((await deliveryOfOrder(placed.body.id)).assignedDriverProfileId).toBeNull();
  });

  it('accepts an order with no pin at all — pinning is optional', async () => {
    const vendor = await makeVendor({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor, { pin: null });
    expect(placed.status).toBe(201);
    const address = await ctx.prisma.orderAddress.findFirstOrThrow({ where: { orderId: placed.body.id } });
    expect(address.latitude).toBeNull();
    expect(address.longitude).toBeNull();
  });
});

/* ===================== THE SIMULATION BOUNDARY ========================== */

describe('simulation isolation', () => {
  it('never offers a simulation delivery to a real driver', async () => {
    const vendor = await makeVendor({ isTest: true });
    const realDriver = await makeDriver({ isTest: false }); // online, eligible, real
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor);
    const delivery = await deliveryOfOrder(placed.body.id);
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { readyForDispatchAt: new Date() } });
    await ctx.prisma.vendorOrder.updateMany({ where: { orderId: placed.body.id }, data: { status: 'READY_FOR_PICKUP' } });

    expect((await engine.dispatch(delivery.id)).result).toBe('NO_CANDIDATES');
    expect((await deliveryOfOrder(placed.body.id)).assignedDriverProfileId).toBeNull();

    // And an ADMIN cannot force it either — the boundary is not just the engine.
    const forced = await post(adminCookies, `admin/deliveries/${delivery.id}/assign`, {
      driverProfileId: realDriver.driverProfileId,
      vehicleId: (await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: realDriver.driverProfileId } })).id,
    });
    expect(forced.status).toBe(400);
    expect(String(forced.body.message)).toMatch(/designated test drivers/i);
  });

  it('never offers a real delivery to a test driver', async () => {
    const vendor = await makeVendor({ isTest: false });
    const testDriver = await makeDriver({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } })).isTest).toBe(false);

    const delivery = await deliveryOfOrder(placed.body.id);
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { readyForDispatchAt: new Date() } });
    await ctx.prisma.vendorOrder.updateMany({ where: { orderId: placed.body.id }, data: { status: 'READY_FOR_PICKUP' } });

    expect((await engine.dispatch(delivery.id)).result).toBe('NO_CANDIDATES');

    const forced = await post(adminCookies, `admin/deliveries/${delivery.id}/assign`, {
      driverProfileId: testDriver.driverProfileId,
      vehicleId: (await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: testDriver.driverProfileId } })).id,
    });
    expect(forced.status).toBe(400);
    expect(String(forced.body.message)).toMatch(/real customer delivery/i);
  });

  it('a customer cannot forge the test flag through the request body', async () => {
    const vendor = await makeVendor({ isTest: false });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 });
    // Every plausible spelling of "make this free".
    const res = await post(customer.cookies, 'checkout', {
      isTest: true,
      is_test: true,
      test: true,
      simulation: true,
      vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: { fullName: 'A B', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE' },
    });
    expect(res.status).toBe(201);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } })).isTest).toBe(false);
  });

  it('refuses a cart that mixes a simulation store with a real one', async () => {
    const testVendor = await makeVendor({ isTest: true });
    const realVendor = await makeVendor({ isTest: false });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    await post(customer.cookies, 'cart/items', { productId: testVendor.productId, quantity: 1 });
    await post(customer.cookies, 'cart/items', { productId: realVendor.productId, quantity: 1 });

    const res = await post(customer.cookies, 'checkout', {
      vendors: [
        { vendorProfileId: testVendor.vendorProfileId, deliveryMethod: 'DELIVERY' },
        { vendorProfileId: realVendor.vendorProfileId, deliveryMethod: 'DELIVERY' },
      ],
      deliveryAddress: { fullName: 'A B', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE' },
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/simulation store/i);
  });

  it('keeps simulation orders out of the analytics figures', async () => {
    const testVendor = await makeVendor({ isTest: true });
    const c1 = await registerCustomer(`sc_${uniq()}@example.com`);
    const before = await get(adminCookies, 'admin/analytics/overview');
    const baseline = before.body.totalOrders;

    expect((await placeOrder(c1, testVendor)).status).toBe(201);

    const after = await get(adminCookies, 'admin/analytics/overview');
    expect(after.body.totalOrders).toBe(baseline);
  });
});

/* ===================== COORDINATE VALIDATION ============================ */

describe('coordinate validation is server-side', () => {
  const bad = [
    { name: 'London', latitude: 51.5074, longitude: -0.1278 },
    { name: 'null island', latitude: 0, longitude: 0 },
    { name: 'transposed', latitude: -88.1976, longitude: 17.4995 },
  ];

  for (const c of bad) {
    it(`rejects a pin at ${c.name}`, async () => {
      const vendor = await makeVendor({ isTest: true });
      const customer = await registerCustomer(`sc_${uniq()}@example.com`);
      await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 });
      const res = await post(customer.cookies, 'checkout', {
        vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
        deliveryAddress: {
          fullName: 'A B',
          addressLine1: '1 St',
          city: 'Belize City',
          district: 'BELIZE',
          latitude: c.latitude,
          longitude: c.longitude,
        },
      });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.orderAddress.count({ where: { latitude: c.latitude } })).toBe(0);
    });
  }

  it('rejects half a pin', async () => {
    const vendor = await makeVendor({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 });
    const res = await post(customer.cookies, 'checkout', {
      vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: { fullName: 'A B', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', latitude: 17.5 },
    });
    expect(res.status).toBe(400);
  });
});

/* ============== PHASE A — THE DRIVER'S TWO ENDS ========================= */

describe('the driver is told where to collect and where to deliver', () => {
  it('carries the vendor pin and instructions through to the driver', async () => {
    const vendor = await makeVendor({ isTest: true });
    // The vendor pins their collection door and leaves a note for drivers.
    await ctx.prisma.vendorLocation.updateMany({
      where: { vendorProfileId: vendor.vendorProfileId },
      data: { latitude: 17.4995, longitude: -88.1976, pickupInstructions: 'Loading bay round the back.' },
    });
    const driver = await makeDriver({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor);
    const delivery = await deliveryOfOrder(placed.body.id);
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { readyForDispatchAt: new Date() } });
    await ctx.prisma.vendorOrder.updateMany({ where: { orderId: placed.body.id }, data: { status: 'READY_FOR_PICKUP' } });
    expect((await engine.dispatch(delivery.id)).result).toBe('ASSIGNED');

    // BEFORE accepting: the shop's address and pin are business information the
    // driver needs to judge the job, so they are available — but the store's
    // private note to its courier is not.
    const before = await get(driver.cookies, `driver/jobs/${delivery.id}`);
    expect(before.body.pickupLocation.pinnedLocation).toEqual({ latitude: 17.4995, longitude: -88.1976 });
    expect(before.body.pickupLocation.navigationUrl).toContain('google.com/maps');
    expect(before.body.pickupLocation.pickupInstructions).toBeNull();

    // AFTER accepting: both ends are fully navigable and the note appears.
    await post(driver.cookies, `driver/jobs/${delivery.id}/accept`);
    const after = await get(driver.cookies, `driver/jobs/${delivery.id}`);
    expect(after.body.pickupLocation.pickupInstructions).toBe('Loading bay round the back.');
    expect(after.body.pickupLocation.navigationUrl).toContain('google.com/maps');
    expect(after.body.navigationUrl).toContain('google.com/maps');
    // The two ends are genuinely different places, not the same link twice.
    expect(after.body.pickupLocation.navigationUrl).not.toBe(after.body.navigationUrl);
  });

  it('degrades to the written address when the store has not pinned itself', async () => {
    const vendor = await makeVendor({ isTest: true });
    await ctx.prisma.vendorLocation.updateMany({
      where: { vendorProfileId: vendor.vendorProfileId },
      data: { latitude: null, longitude: null },
    });
    const driver = await makeDriver({ isTest: true });
    const customer = await registerCustomer(`sc_${uniq()}@example.com`);
    const placed = await placeOrder(customer, vendor);
    const delivery = await deliveryOfOrder(placed.body.id);
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { readyForDispatchAt: new Date() } });
    await ctx.prisma.vendorOrder.updateMany({ where: { orderId: placed.body.id }, data: { status: 'READY_FOR_PICKUP' } });
    expect((await engine.dispatch(delivery.id)).result).toBe('ASSIGNED');

    const body = (await get(driver.cookies, `driver/jobs/${delivery.id}`)).body;
    expect(body.pickupLocation.pinnedLocation).toBeNull();
    expect(body.pickupLocation.navigationUrl).toBeNull();
    // The address is still there — the driver is never left with nothing.
    expect(body.pickupLocation.addressLine1).toBeTruthy();
    expect(body.pickupLocation.city).toBeTruthy();
  });

  it('rejects a vendor pin outside Belize', async () => {
    const vendor = await makeVendor({ isTest: true });
    const owner = await ctx.prisma.user.findUniqueOrThrow({ where: { id: vendor.vendorUserId } });
    const login = await request(ctx.server).post('/api/auth/login').send({ email: owner.email, password: 'CustomerPass123' });
    const cookies = cookiesOf(login);
    const res = await post(cookies, 'vendor/profile/locations', {
      label: 'Bad', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE',
      latitude: 51.5074, longitude: -0.1278, // London
    });
    expect(res.status).toBe(400);
  });
});
