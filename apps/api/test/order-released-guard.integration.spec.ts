/**
 * ORD-RELEASED-GUARD / ORD-RELEASE-AFTER-READY, against real Postgres.
 *
 * Two directions of the same gap, closed in two cards:
 *
 * BEFORE ready (ORD-RELEASED-GUARD, #797): once an admin released an order's
 * reservations (`Order.reservationsReleasedAt` set, payment already
 * CANCELLED/returned — `orders.service.ts`'s `releaseReservationsInTx`),
 * nothing stopped the vendor from continuing to prepare, ready, or collect
 * the same order. The first describe block below proves each forward-motion
 * entry point now refuses, by name, once released — and walks the exact
 * sequence named in the card: pay, admin releases, vendor attempts to ready,
 * attempt is refused. Left exactly as #797 made it; the second describe
 * block adds a new direction without touching this one, so a regression here
 * would show the after-ready fix broke the before-ready one.
 *
 * AFTER ready (ORD-RELEASE-AFTER-READY): the reverse order of events — ready
 * first, release second, once an OrderDelivery already exists. See the
 * second describe block's own comment for what this closes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

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

/** Vendor + published product with stock, both delivery methods enabled. */
async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`orgv${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Guard Store ${s}`,
      slug: `guard-store-${s}`,
      contactEmail: `orgv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Guard Prod ${s}`, slug: `guard-prod-${s}`, sku: `GP-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, vendorCookies: cookies, productId: product.id };
}

/** Funded, paid customer with the vendor's product checked out under the given delivery method. */
async function checkout(vendor: Awaited<ReturnType<typeof makeVendor>>, deliveryMethod: 'DELIVERY' | 'PICKUP') {
  const s = uniq();
  const customer = await registerCustomer(`orgc${s}@example.bz`);
  await post(adminCookies, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 100_000, reason: 'Released-guard fixture.' });
  await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 2 }).expect(201);
  const res = await post(customer.cookies, 'checkout', {
    vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod }],
    deliveryAddress: { fullName: 'Guard Customer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' },
    payWithWallet: true,
  }).expect(201);
  return { customer, orderId: res.body.id as string };
}

const orderRow = (orderId: string) => ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendorOrders: true, payment: true } });
const vendorOrderOf = async (orderId: string) => (await orderRow(orderId)).vendorOrders[0]!;
const release = (orderId: string) => post(adminCookies, `admin/orders/${orderId}/release-reservations`);
const inventoryOf = (productId: string) => ctx.prisma.inventory.findFirstOrThrow({ where: { productId } });
const deliveryOf = (orderId: string) => ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId } } });

interface Driver {
  userId: string;
  cookies: string[];
  driverProfileId: string;
  vehicleId: string;
}
async function makeDriver(): Promise<Driver> {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`guarddrv${s}@example.bz`);
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
  return { userId, cookies, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/**
 * Ready a DELIVERY order, admin-assign a driver, and drive it to `stopAt`.
 *
 * Deliberately no 'EXCEPTION' stop here: that status and its
 * driver/jobs/:id/report-exception endpoint are MDF-927 (PR #801), not yet
 * on main as this branch is cut. cancelForReleasedOrder's own CANCEL check
 * (`canPerform('CANCEL', d.status)`) is generic over DeliveryStatus and
 * needs no special case for EXCEPTION once that status exists — CANCEL's
 * own `from` list already includes it (packages/shared/dispatch.ts) — but a
 * spec cannot drive a driver into a status and through a route this base
 * does not have. Worth a follow-up integration test once #801 merges.
 */
async function dispatched(vendor: Awaited<ReturnType<typeof makeVendor>>, stopAt: 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'DRIVER_ACCEPTED' | 'PICKUP_CONFIRMED' | 'IN_TRANSIT' | 'ARRIVING' | 'DELIVERED') {
  const { orderId } = await checkout(vendor, 'DELIVERY');
  const vo = await vendorOrderOf(orderId);
  expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/start-preparing`)).status).toBe(201);
  expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);
  const delivery = await deliveryOf(orderId);
  if (stopAt === 'PENDING_ASSIGNMENT') return { orderId, delivery, driver: null as Driver | null };

  const driver = await makeDriver();
  expect((await post(adminCookies, `admin/deliveries/${delivery.id}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId })).status).toBe(201);
  if (stopAt === 'ASSIGNED') return { orderId, delivery, driver };

  expect((await post(driver.cookies, `driver/jobs/${delivery.id}/accept`)).status).toBe(201);
  if (stopAt === 'DRIVER_ACCEPTED') return { orderId, delivery, driver };

  const pins = (await get(adminCookies, `admin/deliveries/${delivery.id}/pins`)).body;
  expect((await post(driver.cookies, `driver/jobs/${delivery.id}/confirm-pickup`, { pin: pins.pickupPin })).status).toBe(201);
  if (stopAt === 'PICKUP_CONFIRMED') return { orderId, delivery, driver };

  expect((await post(driver.cookies, `driver/jobs/${delivery.id}/in-transit`)).status).toBe(201);
  if (stopAt === 'IN_TRANSIT') return { orderId, delivery, driver };

  expect((await post(driver.cookies, `driver/jobs/${delivery.id}/arriving`)).status).toBe(201);
  if (stopAt === 'ARRIVING') return { orderId, delivery, driver };

  expect((await post(driver.cookies, `driver/jobs/${delivery.id}/confirm-delivery`, { pin: pins.deliveryPin, recipientName: 'Guard Customer' })).status).toBe(201);
  return { orderId, delivery, driver };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await ctx.prisma.category.create({ data: { name: 'Guard General', slug: `guard-gen-${uniq()}` } });
  categoryId = cat.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('a released order never moves forward again', () => {
  it('REFUSES start-preparing once released, naming the real reason', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'DELIVERY');
    expect((await release(orderId)).status).toBe(201);
    const vo = await vendorOrderOf(orderId);

    const res = await post(vendor.vendorCookies, `vendor/orders/${vo.id}/start-preparing`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This order's payment was returned to the customer; it can no longer be fulfilled.");
    expect((await vendorOrderOf(orderId)).status).toBe('PENDING'); // unchanged
  });

  it('REFUSES ready for a DELIVERY order — the exact sequence: pay, admin releases, vendor attempts to ready, refused — and never arms dispatch', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'DELIVERY');
    const before = await vendorOrderOf(orderId);
    expect((await post(vendor.vendorCookies, `vendor/orders/${before.id}/start-preparing`)).status).toBe(201);

    expect((await release(orderId)).status).toBe(201);
    const released = await orderRow(orderId);
    expect(released.reservationsReleasedAt).not.toBeNull();
    expect(released.payment!.status).toBe('CANCELLED');
    // Vendor-order status is deliberately left untouched by release.
    expect(released.vendorOrders[0]!.status).toBe('PREPARING');

    const res = await post(vendor.vendorCookies, `vendor/orders/${before.id}/ready`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This order's payment was returned to the customer; it can no longer be fulfilled.");

    const after = await orderRow(orderId);
    expect(after.vendorOrders[0]!.status).toBe('PREPARING'); // never reached READY_FOR_PICKUP
    const delivery = await ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId } } });
    expect(delivery.readyForDispatchAt).toBeNull(); // dispatch never armed — no delivery created for a released order
  });

  it('REFUSES ready-for-pickup for a PICKUP order — no PIN is ever issued', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'PICKUP');
    const vo = await vendorOrderOf(orderId);
    expect((await release(orderId)).status).toBe(201);

    const res = await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This order's payment was returned to the customer; it can no longer be fulfilled.");
    const after = await vendorOrderOf(orderId);
    expect(after.status).toBe('PENDING');
    expect(after.pickupPin).toBeNull();
  });

  it('REFUSES confirm-pickup once released, even for an order already READY_FOR_PICKUP before release — and the second finalizeReservation (the over-decrement) never runs', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'PICKUP');
    const vo = await vendorOrderOf(orderId);
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);
    const ready = await vendorOrderOf(orderId);
    expect(ready.status).toBe('READY_FOR_PICKUP');
    expect(ready.pickupPin).not.toBeNull();

    const invBeforeRelease = await inventoryOf(vendor.productId);
    expect((await release(orderId)).status).toBe(201);
    // Release gave the hold back; physical stock quantity is untouched by release.
    const invAfterRelease = await inventoryOf(vendor.productId);
    expect(invAfterRelease.reserved).toBe(0);
    expect(invAfterRelease.quantity).toBe(invBeforeRelease.quantity);

    const res = await post(vendor.vendorCookies, `vendor/orders/${vo.id}/confirm-pickup`, { pin: ready.pickupPin! });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This order's payment was returned to the customer; it can no longer be fulfilled.");

    // THE UNKNOWN, SETTLED: finalizeReservation does not throw — it silently
    // decrements real on-hand `quantity` unconditionally. Had confirm-pickup
    // not refused above, quantity would have dropped a SECOND time for the
    // same units already given back at release. Proven here by its absence:
    // quantity is exactly what release left it at, and inventoryFinalizedAt
    // on the vendor-order was never set.
    const invAfterRefusal = await inventoryOf(vendor.productId);
    expect(invAfterRefusal.quantity).toBe(invAfterRelease.quantity);
    const voAfter = await vendorOrderOf(orderId);
    expect(voAfter.status).toBe('READY_FOR_PICKUP'); // never reached PICKED_UP
    expect(voAfter.inventoryFinalizedAt).toBeNull();
  });

  it('REFUSES the admin pickup override too — releasing is not a loophole around the PIN requirement', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'PICKUP');
    const vo = await vendorOrderOf(orderId);
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);
    expect((await release(orderId)).status).toBe(201);

    const res = await post(adminCookies, `admin/orders/vendor-orders/${vo.id}/confirm-pickup`, { reason: 'Customer insists they already have the goods.' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This order's payment was returned to the customer; it can no longer be fulfilled.");
    expect((await vendorOrderOf(orderId)).status).toBe('READY_FOR_PICKUP');
  });

  it('an order NEVER released reads and ready-s exactly as before (no false positive)', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout(vendor, 'DELIVERY');
    const vo = await vendorOrderOf(orderId);
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/start-preparing`)).status).toBe(201);
    const res = await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`);
    expect(res.status).toBe(201);
    const delivery = await ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId } } });
    expect(delivery.readyForDispatchAt).not.toBeNull();
  });
});

/**
 * ORD-RELEASE-AFTER-READY — the later half of the gap above. #797 closed the
 * BEFORE-ready direction (nothing could start fulfilling an already-released
 * order); this closes the AFTER-ready direction, which #797 did not touch and
 * no spec exercised: an order can be readied and dispatched FIRST, and
 * released SECOND, after an OrderDelivery already exists. Before this fix,
 * dispatch, driver accept, pickup and delivery all proceeded normally on a
 * CANCELLED payment — settlement later refuses it, so the loss lands on
 * whoever physically handed over the goods.
 *
 * DispatchService.cancelForReleasedOrder (apps/api/src/dispatch/dispatch.service.ts)
 * is the one place that now decides, called by releaseReservationsInTx inside
 * the SAME transaction as the release: a delivery still able to use the
 * existing CANCEL edge is cancelled as part of the release (state only — no
 * refund, no escrow, no settlement, no wallet entry beyond what release
 * already does); a delivery already past pickup (PICKUP_CONFIRMED/IN_TRANSIT/
 * ARRIVING — CANCEL's own legal `from` list deliberately excludes these,
 * packages/shared/dispatch.ts) has no safe edge to use, so the WHOLE release
 * is refused rather than left half-applied or silently allowed to proceed.
 */
describe('ORD-RELEASE-AFTER-READY: releasing after an OrderDelivery already exists', () => {
  it('cascades to CANCEL when released before any driver is assigned (PENDING_ASSIGNMENT)', async () => {
    const vendor = await makeVendor();
    const { orderId, delivery } = await dispatched(vendor, 'PENDING_ASSIGNMENT');

    expect((await release(orderId)).status).toBe(201);
    const after = await orderRow(orderId);
    expect(after.reservationsReleasedAt).not.toBeNull();
    expect(after.payment!.status).toBe('CANCELLED');

    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.cancellationReason).toBe("This order's payment was returned to the customer; the delivery could not proceed.");
  });

  it('cascades to CANCEL when released after a driver is ASSIGNED but has not accepted yet, and notifies that driver', async () => {
    const vendor = await makeVendor();
    const { orderId, delivery, driver } = await dispatched(vendor, 'ASSIGNED');

    expect((await release(orderId)).status).toBe(201);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('CANCELLED');

    const n = await ctx.prisma.notification.findFirst({
      where: { event: 'DELIVERY_CANCELLED', recipients: { some: { userId: driver!.userId } } },
      orderBy: { createdAt: 'desc' },
    });
    expect(n).not.toBeNull();
  });

  it('cascades to CANCEL when released after the driver ACCEPTED, before pickup', async () => {
    const vendor = await makeVendor();
    const { orderId, delivery } = await dispatched(vendor, 'DRIVER_ACCEPTED');

    expect((await release(orderId)).status).toBe(201);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('CANCELLED');
  });

  it('REFUSES the release once the driver has confirmed PICKUP — the parcel is already with them, and nothing is half-applied', async () => {
    const vendor = await makeVendor();
    const { orderId, delivery } = await dispatched(vendor, 'PICKUP_CONFIRMED');

    const res = await release(orderId);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already been picked up');

    // Nothing moved: not released, payment untouched, delivery untouched.
    const after = await orderRow(orderId);
    expect(after.reservationsReleasedAt).toBeNull();
    expect(after.payment!.status).not.toBe('CANCELLED');
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('PICKUP_CONFIRMED');
  });

  it('REFUSES the release while IN_TRANSIT and while ARRIVING too — not just at the instant pickup is confirmed', async () => {
    const vendorA = await makeVendor();
    const inTransit = await dispatched(vendorA, 'IN_TRANSIT');
    expect((await release(inTransit.orderId)).status).toBe(409);

    const vendorB = await makeVendor();
    const arriving = await dispatched(vendorB, 'ARRIVING');
    expect((await release(arriving.orderId)).status).toBe(409);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: arriving.delivery.id } });
    expect(row.status).toBe('ARRIVING'); // untouched
  });

  // NOT TESTED HERE (deliberately): once MDF-927 (#801) merges and
  // DeliveryStatus.EXCEPTION exists, releasing after a driver has raised a
  // post-pickup exception should also cascade to CANCEL — CANCEL's `from`
  // list already includes EXCEPTION (packages/shared/dispatch.ts), and
  // cancelForReleasedOrder's check is generic over DeliveryStatus, so no
  // code change is expected to be needed. This base (origin/main as this
  // branch is cut) has neither that status nor the report-exception route
  // to drive a real delivery into it, so the claim above is reasoned, not
  // proven, and should get its own integration test once #801 merges.

  it('leaves an already-DELIVERED order alone — nothing live to cancel, release behaves exactly as #797 left it', async () => {
    const vendor = await makeVendor();
    const { orderId, delivery } = await dispatched(vendor, 'DELIVERED');

    expect((await release(orderId)).status).toBe(201);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('DELIVERED'); // untouched — already terminal
    const after = await orderRow(orderId);
    expect(after.reservationsReleasedAt).not.toBeNull(); // the release itself still proceeds
  });
});
