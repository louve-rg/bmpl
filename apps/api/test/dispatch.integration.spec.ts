/**
 * Dispatch & Delivery Execution (Phase 4 · M15) — integration vs real Postgres +
 * MinIO. Covers eligible/ineligible assignment, the strict state machine, driver
 * accept/decline, pickup & delivery PIN verification (success/failure/rate-limit/
 * idempotency), exactly-once inventory finalization, assignment isolation,
 * customer/vendor visibility, admin permissions, timeline/audit/notifications,
 * multi-vendor independence, and the NO-money invariant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, putToPresigned, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

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
  vendorUserId: string;
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
  return { vendorProfileId: vp.id, vendorUserId: userId, vendorCookies: cookies, productId: product.id, inventoryId: inv.id };
}

interface DeliveryOrder {
  deliveryId: string;
  customerId: string;
  customerCookies: string[];
}
async function makeDeliveryOrder(vendor: Vendor, opts: { qty?: number; district?: string } = {}): Promise<DeliveryOrder> {
  const qty = opts.qty ?? 2;
  const district = opts.district ?? 'BELIZE';
  const s = uniq();
  const { userId: customerId, cookies: customerCookies } = await registerCustomer(`cust_${s}@example.bz`);
  // Simulate the checkout reservation (M10 reserves at order creation).
  await ctx.prisma.inventory.update({ where: { id: vendor.inventoryId }, data: { reserved: { increment: qty } } });
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num,
      userId: customerId,
      status: 'PENDING',
      itemCount: qty,
      subtotalMinor: BigInt(1000 * qty),
      deliveryFeeMinor: 500n,
      totalMinor: BigInt(1000 * qty + 500),
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: district as never } },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: 'PENDING',
          deliveryMethod: 'DELIVERY',
          itemCount: qty,
          subtotalMinor: BigInt(1000 * qty),
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: qty, subtotalMinor: BigInt(1000 * qty) } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return { deliveryId: order.vendorOrders[0]!.delivery!.id, customerId, customerCookies };
}

interface Driver {
  cookies: string[];
  userId: string;
  driverProfileId: string;
  vehicleId: string;
}
async function makeDriver(
  opts: {
    roleStatus?: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED';
    availability?: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
    isActive?: boolean;
    licenceExpiry?: Date;
    registrationExpiry?: Date;
    insuranceExpiry?: Date;
    vehicleApproval?: 'PENDING' | 'APPROVED' | 'REJECTED';
    districts?: string[];
    displayName?: string;
  } = {},
): Promise<Driver> {
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
      displayName: opts.displayName ?? `Drv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `DL-${s}`,
      licenceExpiry: opts.licenceExpiry ?? FUTURE,
      vehicleOwnership: 'OWNED',
      availability: opts.availability ?? 'ONLINE',
      isActive: opts.isActive ?? true,
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
      isActive: true,
      isPrimary: true,
      approvalStatus: opts.vehicleApproval ?? 'APPROVED',
    },
  });
  for (const d of opts.districts ?? ['BELIZE']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Drive a fresh delivery all the way to ASSIGNED with an eligible driver. */
async function assignedDelivery(district = 'BELIZE') {
  const vendor = await makeVendor();
  const order = await makeDeliveryOrder(vendor, { district });
  const driver = await makeDriver({ districts: [district] });
  const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
  expect(res.status).toBe(201);
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

describe('admin assignment + eligibility', () => {
  it('assigns an eligible driver → ASSIGNED with history + timeline', async () => {
    const { order, driver } = await assignedDelivery();
    const detail = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    expect(detail.body.status).toBe('ASSIGNED');
    expect(detail.body.driver.displayName).toBe(await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: driver.driverProfileId } }).then((p) => p.displayName));
    expect(detail.body.assignmentHistory).toHaveLength(1);
    expect(detail.body.timeline.map((t: { event: string }) => t.event)).toContain('ASSIGN');
    // a fresh pickup + delivery PIN were generated
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(row.pickupPin).toMatch(/^\d{4}$/);
    expect(row.deliveryPin).toMatch(/^\d{4}$/);
  });

  it('lists eligible drivers for the delivery district', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver({ displayName: 'Eligible One' });
    const res = await get(adminCookies, `admin/deliveries/${order.deliveryId}/eligible-drivers`);
    expect(res.status).toBe(200);
    expect(res.body.some((d: { driverProfileId: string }) => d.driverProfileId === driver.driverProfileId)).toBe(true);
  });

  it('rejects an OFFLINE driver', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver({ availability: 'OFFLINE' });
    const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not online/i);
  });

  it('rejects a district mismatch', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor, { district: 'BELIZE' });
    const driver = await makeDriver({ districts: ['CAYO'] });
    const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not serve/i);
  });

  it('rejects an unapproved driver role', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver({ roleStatus: 'PENDING' });
    const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
    expect(res.status).toBe(400);
  });

  it('rejects an expired licence and a non-approved vehicle', async () => {
    const vendor = await makeVendor();
    const order1 = await makeDeliveryOrder(vendor);
    const expired = await makeDriver({ licenceExpiry: PAST });
    expect((await post(adminCookies, `admin/deliveries/${order1.deliveryId}/assign`, { driverProfileId: expired.driverProfileId, vehicleId: expired.vehicleId })).status).toBe(400);
    const order2 = await makeDeliveryOrder(vendor);
    const pendingVeh = await makeDriver({ vehicleApproval: 'PENDING' });
    expect((await post(adminCookies, `admin/deliveries/${order2.deliveryId}/assign`, { driverProfileId: pendingVeh.driverProfileId, vehicleId: pendingVeh.vehicleId })).status).toBe(400);
    const order3 = await makeDeliveryOrder(vendor);
    const expiredReg = await makeDriver({ registrationExpiry: PAST });
    expect((await post(adminCookies, `admin/deliveries/${order3.deliveryId}/assign`, { driverProfileId: expiredReg.driverProfileId, vehicleId: expiredReg.vehicleId })).status).toBe(400);
  });

  it('reassigns to a new driver (requires a reason) and preserves history', async () => {
    const { order, driver: first } = await assignedDelivery();
    const second = await makeDriver({ displayName: 'Second Driver' });
    // reason required
    expect((await post(adminCookies, `admin/deliveries/${order.deliveryId}/reassign`, { driverProfileId: second.driverProfileId, vehicleId: second.vehicleId })).status).toBe(400);
    const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/reassign`, { driverProfileId: second.driverProfileId, vehicleId: second.vehicleId, reason: 'first was unreachable' });
    expect(res.status).toBe(201);
    const history = await get(adminCookies, `admin/deliveries/${order.deliveryId}/history`);
    expect(history.body).toHaveLength(2);
    expect(history.body.find((h: { status: string }) => h.status === 'REASSIGNED')).toBeTruthy();
    const detail = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    expect(detail.body.status).toBe('ASSIGNED');
    expect(detail.body.driver.displayName).toBe('Second Driver');
    void first;
  });

  it('cancels a pre-pickup assignment; cannot cancel after pickup', async () => {
    const { order } = await assignedDelivery();
    const res = await post(adminCookies, `admin/deliveries/${order.deliveryId}/cancel`, { reason: 'customer cancelled' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CANCELLED');
    // a delivered delivery cannot be cancelled
    const flow = await deliverFully();
    expect((await post(adminCookies, `admin/deliveries/${flow.order.deliveryId}/cancel`, { reason: 'too late' })).status).toBe(400);
  });

  it('a missing delivery returns 404 (admin + customer)', async () => {
    expect((await get(adminCookies, 'admin/deliveries/nonexistentid')).status).toBe(404);
    const cust = await registerCustomer(`nf_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'deliveries/nonexistentid')).status).toBe(404);
  });

  it('auto-assign preview never assigns', async () => {
    const { order } = await assignedDelivery();
    const before = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    const historyBefore = await get(adminCookies, `admin/deliveries/${order.deliveryId}/history`);

    const res = await get(adminCookies, `admin/deliveries/${order.deliveryId}/auto-assign-preview`);
    expect(res.status).toBe(200);
    // `implemented` reported whether an auto-assignment engine EXISTED. It was
    // false while the endpoint was a stub; M26.3 built the engine, so asserting
    // false here would now assert that automatic dispatch is missing.
    expect(res.body.implemented).toBe(true);
    expect(typeof res.body.candidateCount).toBe('number');

    // The invariant this test is NAMED for — previously never actually checked,
    // since the stub flag was its only assertion. Preview is a read: it may
    // report who would be offered the job, and change nothing while doing so.
    const after = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    expect(after.body.status).toBe(before.body.status);
    expect(after.body.driver?.displayName).toBe(before.body.driver?.displayName);
    expect(after.body.timestamps.assignedAt).toBe(before.body.timestamps.assignedAt);

    // No new assignment row, and no extra timeline event.
    const historyAfter = await get(adminCookies, `admin/deliveries/${order.deliveryId}/history`);
    expect(historyAfter.body).toHaveLength(historyBefore.body.length);
    const timeline = await get(adminCookies, `admin/deliveries/${order.deliveryId}/timeline`);
    expect(timeline.body.some((t: { event: string }) => t.event === 'ASSIGN')).toBe(true);
    expect(timeline.body.filter((t: { event: string }) => t.event === 'ASSIGN')).toHaveLength(1);
  });
});

describe('driver job workflow + verification', () => {
  it('driver sees only their own jobs; another driver is 404', async () => {
    const { order, driver } = await assignedDelivery();
    const other = await makeDriver();
    expect((await get(driver.cookies, `driver/jobs/${order.deliveryId}`)).status).toBe(200);
    expect((await get(other.cookies, `driver/jobs/${order.deliveryId}`)).status).toBe(404);
    expect((await post(other.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(404);
  });

  it('accept → pickup(PIN) → in-transit → arriving → deliver(PIN)', async () => {
    const { vendor, order, driver } = await assignedDelivery();
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`)).body.status).toBe('DRIVER_ACCEPTED');
    // wrong pickup PIN fails
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: '0000' })).status).toBe(400);
    // vendor reveals the pickup PIN
    const pinRes = await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/pickup-pin`);
    expect(pinRes.status).toBe(200);
    const okPickup = await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: pinRes.body.pickupPin });
    expect(okPickup.body.status).toBe('PICKUP_CONFIRMED');
    // cannot skip states
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`)).status).toBe(400);
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`)).body.status).toBe('IN_TRANSIT');
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`)).body.status).toBe('ARRIVING');
    // delivery PIN from the customer
    const dpin = await get(order.customerCookies, `deliveries/${order.deliveryId}/pin`);
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: '9999', recipientName: 'X' })).status).toBe(400);
    const done = await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: dpin.body.deliveryPin, recipientName: 'Jane Recipient' });
    expect(done.body.status).toBe('DELIVERED');
    expect(done.body.recipientName).toBe('Jane Recipient');
    // driver completed-deliveries incremented
    const p = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: driver.driverProfileId } });
    expect(p.completedDeliveries).toBe(1);
  });

  it('invalid transition returns a clear error (in-transit before pickup)', async () => {
    const { order, driver } = await assignedDelivery();
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    const res = await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`);
    expect(res.status).toBe(400);
  });

  it('driver decline requires a reason and returns the job to the pool', async () => {
    const { order, driver } = await assignedDelivery();
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/decline`)).status).toBe(400); // no reason
    const res = await post(driver.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'too far' });
    expect(res.status).toBe(201);
    const detail = await get(adminCookies, `admin/deliveries/${order.deliveryId}`);
    expect(detail.body.status).toBe('DRIVER_DECLINED');
    expect(detail.body.driver).toBeNull();
  });

  it('pickup PIN locks after too many attempts (rate-limit)', async () => {
    const { order, driver } = await assignedDelivery();
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    for (let i = 0; i < 5; i += 1) {
      await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: '0001' });
    }
    const locked = await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: '0001' });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/locked|too many/i);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(row.pickupVerificationStatus).toBe('FAILED');
  });
});

describe('inventory finalization (exactly once)', () => {
  it('pickup deducts reserved+quantity once; repeated pickup is idempotent', async () => {
    const { vendor, order, driver } = await assignedDelivery();
    const before = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(before.reserved).toBe(2); // reserved at order creation
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    const pin = (await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/pickup-pin`)).body.pickupPin;
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin });
    const after = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(after.quantity).toBe(before.quantity - 2); // real deduction
    expect(after.reserved).toBe(before.reserved - 2); // reservation cleared
    const fulfilled = await ctx.prisma.inventoryChange.findMany({ where: { inventoryId: vendor.inventoryId, reason: 'FULFILLED' } });
    expect(fulfilled).toHaveLength(1);
    // idempotent re-confirm — no second deduction
    const again = await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin });
    expect(again.body.status).toBe('PICKUP_CONFIRMED');
    const after2 = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(after2.quantity).toBe(after.quantity);
    expect(await ctx.prisma.inventoryChange.count({ where: { inventoryId: vendor.inventoryId, reason: 'FULFILLED' } })).toBe(1);
  });
});

describe('visibility, proof, permissions', () => {
  it('customer sees their delivery; a different customer is 404; driver docs are not exposed', async () => {
    const { order } = await assignedDelivery();
    const view = await get(order.customerCookies, `deliveries/${order.deliveryId}`);
    expect(view.status).toBe(200);
    expect(view.body.driver.displayName).toBeTruthy();
    expect(view.body.driver.legalName).toBeUndefined();
    expect(view.body.driver.phone).toBeUndefined();
    const other = await registerCustomer(`other_${uniq()}@example.bz`);
    expect((await get(other.cookies, `deliveries/${order.deliveryId}`)).status).toBe(404);
  });

  it('vendor sees their delivery; proof upload is viewable by customer + vendor', async () => {
    const { vendor, order, driver } = await assignedDelivery();
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    const ppin = (await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/pickup-pin`)).body.pickupPin;
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: ppin });
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`);
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`);
    // upload a POD photo through the real presign → MinIO round-trip
    const presign = await post(driver.cookies, `driver/jobs/${order.deliveryId}/pod/presign`, { fileName: 'pod.jpg', contentType: 'image/jpeg', sizeBytes: 4 });
    expect(presign.status).toBe(201);
    const uploadStatus = await putToPresigned(presign.body.uploadUrl, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
    expect(uploadStatus).toBe(200);
    const dpin = (await get(order.customerCookies, `deliveries/${order.deliveryId}/pin`)).body.deliveryPin;
    const done = await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: dpin, recipientName: 'R', podPhotoKeys: [presign.body.key] });
    expect(done.body.status).toBe('DELIVERED');
    const custProof = await get(order.customerCookies, `deliveries/${order.deliveryId}/proof`);
    expect(custProof.body.podPhotoUrls).toHaveLength(1);
    const vendProof = await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/proof`);
    expect(vendProof.body.podPhotoUrls).toHaveLength(1);
  });

  it('admin dispatch requires the delivery permissions', async () => {
    const { order } = await assignedDelivery();
    const noPerms = await seedLimitedAdmin(ctx.prisma, `disp_none_${uniq()}@example.bz`, ['orders.read']);
    const npCookies = await login(noPerms.email, noPerms.password);
    expect((await get(npCookies, `admin/deliveries/${order.deliveryId}`)).status).toBe(403);
    const readOnly = await seedLimitedAdmin(ctx.prisma, `disp_read_${uniq()}@example.bz`, ['deliveries.read']);
    const roCookies = await login(readOnly.email, readOnly.password);
    expect((await get(roCookies, `admin/deliveries/${order.deliveryId}`)).status).toBe(200);
    // read-only admin cannot assign or reveal PINs
    const drv = await makeDriver();
    expect((await post(roCookies, `admin/deliveries/${order.deliveryId}/reassign`, { driverProfileId: drv.driverProfileId, vehicleId: drv.vehicleId, reason: 'x' })).status).toBe(403);
    expect((await get(roCookies, `admin/deliveries/${order.deliveryId}/pins`)).status).toBe(403);
  });

  it('a non-driver (customer) cannot reach the driver job feed', async () => {
    const { order } = await assignedDelivery();
    const cust = await registerCustomer(`plain_${uniq()}@example.bz`);
    expect((await get(cust.cookies, `driver/jobs/${order.deliveryId}`)).status).toBe(403);
  });
});

describe('audit, notifications, and the no-money invariant', () => {
  it('full lifecycle writes audit + timeline + notifications and moves NO money', async () => {
    const ledgerBefore = await ctx.prisma.walletLedgerEntry.count();
    const txBefore = await ctx.prisma.walletTransaction.count();
    const { order, driver, vendor } = await deliverFully();
    // timeline has every transition
    const timeline = await get(adminCookies, `admin/deliveries/${order.deliveryId}/timeline`);
    const events = timeline.body.map((t: { event: string }) => t.event);
    expect(events).toEqual(expect.arrayContaining(['ASSIGN', 'ACCEPT', 'CONFIRM_PICKUP', 'IN_TRANSIT', 'ARRIVING', 'DELIVER']));
    // audit rows for the dispatch actions
    const actions = await ctx.prisma.auditLog.findMany({ where: { action: { in: ['DELIVERY_ASSIGNED', 'DELIVERY_PICKUP_CONFIRMED', 'DELIVERY_COMPLETED', 'INVENTORY_FULFILLED'] } }, select: { action: true } });
    for (const a of ['DELIVERY_ASSIGNED', 'DELIVERY_PICKUP_CONFIRMED', 'DELIVERY_COMPLETED', 'INVENTORY_FULFILLED']) {
      expect(actions.some((x) => x.action === a)).toBe(true);
    }
    // customer got at least one delivery notification
    expect(await ctx.prisma.notificationRecipient.count({ where: { userId: order.customerId, notification: { category: 'DELIVERY' } } })).toBeGreaterThan(0);
    // NO wallet movement occurred during the entire dispatch lifecycle
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(ledgerBefore);
    expect(await ctx.prisma.walletTransaction.count()).toBe(txBefore);
    void driver;
    void vendor;
  });

  it('multi-vendor deliveries are independent', async () => {
    const vendorA = await makeVendor();
    const vendorB = await makeVendor();
    const orderA = await makeDeliveryOrder(vendorA);
    const orderB = await makeDeliveryOrder(vendorB);
    // complete A only
    const driverA = await makeDriver();
    await post(adminCookies, `admin/deliveries/${orderA.deliveryId}/assign`, { driverProfileId: driverA.driverProfileId, vehicleId: driverA.vehicleId });
    await post(driverA.cookies, `driver/jobs/${orderA.deliveryId}/accept`);
    const ppin = (await get(vendorA.vendorCookies, `vendor/deliveries/${orderA.deliveryId}/pickup-pin`)).body.pickupPin;
    await post(driverA.cookies, `driver/jobs/${orderA.deliveryId}/confirm-pickup`, { pin: ppin });
    // B untouched
    const bDetail = await get(adminCookies, `admin/deliveries/${orderB.deliveryId}`);
    expect(bDetail.body.status).toBe('PENDING_ASSIGNMENT');
    const bInv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendorB.inventoryId } });
    expect(bInv.reserved).toBe(2); // still reserved, not finalized
  });
});

/** Assign → accept → pickup → in-transit → arriving → deliver, returning context. */
async function deliverFully() {
  const { vendor, order, driver } = await assignedDelivery();
  await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
  const ppin = (await get(vendor.vendorCookies, `vendor/deliveries/${order.deliveryId}/pickup-pin`)).body.pickupPin;
  await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: ppin });
  await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`);
  await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`);
  const dpin = (await get(order.customerCookies, `deliveries/${order.deliveryId}/pin`)).body.deliveryPin;
  await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: dpin, recipientName: 'Recipient' });
  return { vendor, order, driver };
}
