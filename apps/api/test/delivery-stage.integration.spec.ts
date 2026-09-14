/**
 * Honest delivery stage — integration against real Postgres.
 *
 * The customer-facing status label said "Awaiting driver" from the moment of
 * checkout, before the vendor had packed anything. The delivery payload now
 * carries `stage`/`stageLabel` naming the real gate, and the admin dispatch
 * list carries `needsManualAssignment` + top-level `automaticDispatch` so ops
 * can see when a human must assign.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patchOps = (b: object) => request(ctx.server).patch('/api/admin/ops/settings').set('Cookie', adminCookies).send(b);

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Vendor + published product with stock, delivery enabled (raw onboarding — separately tested). */
async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`stage_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Stage Store ${s}`,
      slug: `stage-store-${s}`,
      contactEmail: `sv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      // No zone configured → the base flat fee prices BELIZE ("no base + no
      // zone = not served" would refuse the checkout otherwise).
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Stage Prod ${s}`, slug: `stage-prod-${s}`, sku: `SP-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, vendorCookies: cookies, productId: product.id };
}

/** Approved ONLINE driver with approved vehicle + BELIZE service area (raw onboarding — separately tested). */
async function makeDriver() {
  const s = uniq();
  const { userId } = await registerCustomer(`stage_d${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await ctx.prisma.driverProfile.create({
    data: { userId, legalName: 'D River', displayName: `StageDrv${s}`, phone: '+5016000000', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: { driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla', licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE, isActive: true, isPrimary: true, approvalStatus: 'APPROVED' },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { driverProfileId: profile.id, vehicleId: vehicle.id, userId };
}

/** Product-path DELIVERY order: cart → checkout. Returns ids + the customer's view handle. */
async function checkoutDeliveryOrder(vendor: Awaited<ReturnType<typeof makeVendor>>) {
  const s = uniq();
  const customer = await registerCustomer(`stage_c${s}@example.bz`);
  await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 }).expect(201);
  const res = await post(customer.cookies, 'checkout', {
    vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
    deliveryAddress: { fullName: 'Stage Customer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' },
  }).expect(201);
  const vo = res.body.vendorOrders[0];
  return { customer, orderId: res.body.id as string, vendorOrderId: vo.id as string, deliveryId: vo.delivery.id as string };
}

const customerDelivery = async (customer: { cookies: string[] }, orderId: string) => {
  const res = await get(customer.cookies, `orders/${orderId}`).expect(200);
  return res.body.vendorOrders[0].delivery;
};

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await ctx.prisma.category.create({ data: { name: 'Stage General', slug: `stage-gen-${uniq()}` } });
  categoryId = cat.id;
  // Deterministic baseline: manual dispatch (also the shipped default).
  await patchOps({ dispatchAutomatic: false }).expect(200);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('the delivery payload tells the truth about where the order is', () => {
  it('walks one order through every stage: AWAITING_VENDOR → AWAITING_DISPATCH → OFFERED → null', async () => {
    const vendor = await makeVendor();
    const driver = await makeDriver();
    const { customer, orderId, vendorOrderId, deliveryId } = await checkoutDeliveryOrder(vendor);

    // Fresh checkout: status is PENDING_ASSIGNMENT, but the store has not packed.
    let d = await customerDelivery(customer, orderId);
    expect(d.status).toBe('PENDING_ASSIGNMENT');
    expect(d.stage).toBe('AWAITING_VENDOR');
    expect(d.stageLabel).toBe('Being packed by the store');

    // Vendor marks ready: now it truly waits for dispatch.
    await post(vendor.vendorCookies, `vendor/orders/${vendorOrderId}/ready`).expect(201);
    d = await customerDelivery(customer, orderId);
    expect(d.stage).toBe('AWAITING_DISPATCH');
    expect(d.stageLabel).toBe('Waiting for a driver to be assigned');

    // Admin offers it to a driver: offered, not yet accepted.
    await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId }).expect(201);
    d = await customerDelivery(customer, orderId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.stage).toBe('OFFERED');
    expect(d.stageLabel).toBe('Driver offered');

    // Driver accepts: the stage steps aside — the status label is honest from here.
    await ctx.prisma.orderDelivery.update({ where: { id: deliveryId }, data: { status: 'DRIVER_ACCEPTED' } });
    d = await customerDelivery(customer, orderId);
    expect(d.stage).toBeNull();
    expect(d.stageLabel).toBeNull();

    // The vendor's own order view carries the same fields.
    const vres = await get(vendor.vendorCookies, `vendor/orders/${vendorOrderId}`).expect(200);
    expect(vres.body.delivery.stage).toBeNull();
  });
});

describe('admin dispatch list: needsManualAssignment + automaticDispatch', () => {
  it('flags ready-unassigned rows only while automatic dispatch is off, and says which mode is active', async () => {
    const vendor = await makeVendor();
    const notReady = await checkoutDeliveryOrder(vendor);
    const ready = await checkoutDeliveryOrder(vendor);
    await post(vendor.vendorCookies, `vendor/orders/${ready.vendorOrderId}/ready`).expect(201);

    const res = await get(adminCookies, 'admin/deliveries').expect(200);
    expect(res.body.automaticDispatch).toBe(false);
    const byId = new Map(res.body.deliveries.map((r: { id: string }) => [r.id, r]));

    // Ready + unassigned + automatic off = a human must act.
    expect((byId.get(ready.deliveryId) as { needsManualAssignment: boolean }).needsManualAssignment).toBe(true);
    // Not ready: nothing to assign yet — the vendor is the gate, not ops.
    expect((byId.get(notReady.deliveryId) as { needsManualAssignment: boolean }).needsManualAssignment).toBe(false);

    // Assigned rows stop needing a human.
    const driver = await makeDriver();
    await post(adminCookies, `admin/deliveries/${ready.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId }).expect(201);
    const after = await get(adminCookies, 'admin/deliveries').expect(200);
    const assignedRow = after.body.deliveries.find((r: { id: string }) => r.id === ready.deliveryId);
    expect(assignedRow.needsManualAssignment).toBe(false);

    // With automatic dispatch ON the same ready-unassigned shape is the
    // engine's job, not a human's — the flag must go quiet.
    const readyAuto = await checkoutDeliveryOrder(vendor);
    await patchOps({ dispatchAutomatic: true }).expect(200);
    try {
      // Mark ready AFTER enabling: the engine may auto-offer it (that is the
      // point of automatic mode); either way no row may claim a human is needed.
      await post(vendor.vendorCookies, `vendor/orders/${readyAuto.vendorOrderId}/ready`).expect(201);
      const auto = await get(adminCookies, 'admin/deliveries').expect(200);
      expect(auto.body.automaticDispatch).toBe(true);
      expect(auto.body.deliveries.some((r: { needsManualAssignment: boolean }) => r.needsManualAssignment)).toBe(false);
    } finally {
      await patchOps({ dispatchAutomatic: false }).expect(200);
    }
  });
});
