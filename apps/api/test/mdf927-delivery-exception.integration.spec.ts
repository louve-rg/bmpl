/**
 * MDF-927: the one edge off a marketplace delivery's forward track once a
 * driver already holds the job (PICKUP_CONFIRMED / IN_TRANSIT / ARRIVING).
 * Before this, DELIVERY_ACTIONS had no such edge at all — a driver who
 * could not complete a job after pickup had no legal next action, and
 * neither did an admin. See packages/shared/src/dispatch.ts's own comment
 * on RAISE_EXCEPTION for why this is terminal-by-design (admin CANCEL is
 * the only way out) rather than a retry back to ASSIGNED.
 *
 * Also proves the two standing boundaries this change touches:
 *  - a driver's own job-feed response never carries a staff-entered reason
 *    (cancellationReason), only their own (exceptionReason);
 *  - no pickup/delivery PIN is exposed through any response here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

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

interface Vendor {
  vendorProfileId: string;
  vendorCookies: string[];
  productId: string;
  inventoryId: string;
}
async function makeVendor(): Promise<Vendor> {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`vend_${s}@example.bz`);
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
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  return { vendorProfileId: vp.id, vendorCookies: cookies, productId: product.id, inventoryId: inv.id };
}

interface DeliveryOrder {
  deliveryId: string;
  customerCookies: string[];
}
async function makeDeliveryOrder(vendor: Vendor): Promise<DeliveryOrder> {
  const s = uniq();
  const { userId: customerId, cookies: customerCookies } = await registerCustomer(`cust_${s}@example.bz`);
  await ctx.prisma.inventory.update({ where: { id: vendor.inventoryId }, data: { reserved: { increment: 2 } } });
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num,
      userId: customerId,
      status: 'PENDING',
      itemCount: 2,
      subtotalMinor: 2000n,
      deliveryFeeMinor: 500n,
      totalMinor: 2500n,
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' } },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: 'PENDING',
          deliveryMethod: 'DELIVERY',
          itemCount: 2,
          subtotalMinor: 2000n,
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 2, subtotalMinor: 2000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return { deliveryId: order.vendorOrders[0]!.delivery!.id, customerCookies };
}

interface Driver {
  cookies: string[];
  driverProfileId: string;
  vehicleId: string;
}
async function makeDriver(): Promise<Driver> {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: { userId, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: { driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla', licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE, isActive: true, isPrimary: true, approvalStatus: 'APPROVED' },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Vendor + order + driver, picked up and on the road (ARRIVING by default). */
async function deliveryInFlight(stopAt: 'PICKUP_CONFIRMED' | 'IN_TRANSIT' | 'ARRIVING' = 'ARRIVING') {
  const vendor = await makeVendor();
  const order = await makeDeliveryOrder(vendor);
  const driver = await makeDriver();
  const assign = await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
  expect(assign.status).toBe(201);
  expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(201);
  const pinRes = await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/pickup-pin`);
  expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: pinRes.body.pickupPin })).status).toBe(201);
  if (stopAt === 'PICKUP_CONFIRMED') return { vendor, order, driver };
  expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`)).status).toBe(201);
  if (stopAt === 'IN_TRANSIT') return { vendor, order, driver };
  expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`)).status).toBe(201);
  return { vendor, order, driver };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await ctx.prisma.category.create({ data: { name: 'General', slug: `gen-${uniq()}` } });
  categoryId = cat.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('MDF-927: driver-reported delivery exception', () => {
  it('a driver ARRIVING with nobody home can report it; the delivery lands in EXCEPTION with a reason, not stuck', async () => {
    const { order, driver } = await deliveryInFlight('ARRIVING');
    const res = await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'Recipient not answering, called twice' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('EXCEPTION');

    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(row.status).toBe('EXCEPTION');
    expect(row.exceptionReason).toBe('Recipient not answering, called twice');
    expect(row.exceptionAt).not.toBeNull();

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'DELIVERY_EXCEPTION_RAISED' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    expect((audit!.newValue as Record<string, unknown>).deliveryId).toBe(order.deliveryId);
  });

  it('is reachable from PICKUP_CONFIRMED and IN_TRANSIT too, not only ARRIVING', async () => {
    const pc = await deliveryInFlight('PICKUP_CONFIRMED');
    expect((await post(pc.driver.cookies, `driver/jobs/${pc.order.deliveryId}/report-exception`, { reason: 'Vehicle broke down' })).body.status).toBe('EXCEPTION');

    const it_ = await deliveryInFlight('IN_TRANSIT');
    expect((await post(it_.driver.cookies, `driver/jobs/${it_.order.deliveryId}/report-exception`, { reason: 'Address does not exist' })).body.status).toBe('EXCEPTION');
  });

  it('cannot be raised before pickup — the state machine still gates it, this is not a stub', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver();
    await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
    // ASSIGNED, not yet accepted
    const res = await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'too early' });
    expect(res.status).toBe(400);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(row.status).toBe('ASSIGNED');
  });

  it('a reason is mandatory', async () => {
    const { order, driver } = await deliveryInFlight('ARRIVING');
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, {})).status).toBe(400);
  });

  it('another driver cannot report an exception on a job that is not theirs', async () => {
    const { order } = await deliveryInFlight('ARRIVING');
    const other = await makeDriver();
    expect((await post(other.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'not mine' })).status).toBe(404);
  });

  it('admin can cancel out of EXCEPTION (the one legal way out) — inventory stays finalized, nothing reversed', async () => {
    const { order, driver } = await deliveryInFlight('ARRIVING');
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'Could not reach the recipient' })).body.status).toBe('EXCEPTION');

    const before = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(before.inventoryFinalizedAt).not.toBeNull(); // already finalized at pickup

    const cancel = await post(adminCookies, `admin/deliveries/${order.deliveryId}/cancel`, { reason: 'Could not reach recipient after repeated attempts' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.status).toBe('CANCELLED');

    const after = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(after.inventoryFinalizedAt).toEqual(before.inventoryFinalizedAt); // unchanged — no reversal step exists
  });

  it('admin CANNOT reassign out of EXCEPTION — terminal by design, not a retry (see dispatch.ts for why)', async () => {
    const { order, driver } = await deliveryInFlight('ARRIVING');
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'Gate locked, could not get in' })).body.status).toBe('EXCEPTION');

    const other = await makeDriver();
    const reassign = await post(adminCookies, `admin/deliveries/${order.deliveryId}/reassign`, { driverProfileId: other.driverProfileId, vehicleId: other.vehicleId, reason: 'try someone else' });
    expect(reassign.status).toBe(400);

    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(row.status).toBe('EXCEPTION'); // unchanged — the rejected call did not move it
  });

  it('boundary: a staff-entered reason never reaches the driver, even for the delivery they themselves flagged', async () => {
    const { order, driver } = await deliveryInFlight('ARRIVING');
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/report-exception`, { reason: 'Recipient address does not exist' })).body.status).toBe('EXCEPTION');

    // Admin resolves it with their OWN, staff-authored note.
    const cancel = await post(adminCookies, `admin/deliveries/${order.deliveryId}/cancel`, { reason: 'Confirmed bad address with vendor — customer will be asked to re-book' });
    expect(cancel.status).toBe(201);

    // The admin's own payload carries their note.
    const adminView = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    expect(adminView.body.cancellationReason).toBe('Confirmed bad address with vendor — customer will be asked to re-book');

    // The driver's own view carries their OWN report, but never the admin's note,
    // and never a pickup/delivery PIN (unchanged, pre-existing guarantee).
    const driverView = await get(driver.cookies, `driver/jobs/${order.deliveryId}`);
    expect(driverView.body.exceptionReason).toBe('Recipient address does not exist');
    expect(driverView.body.cancellationReason).toBeUndefined();
    expect(JSON.stringify(driverView.body)).not.toContain('Confirmed bad address with vendor');
    expect(driverView.body.pickupPin).toBeUndefined();
    expect(driverView.body.deliveryPin).toBeUndefined();
  });
});
