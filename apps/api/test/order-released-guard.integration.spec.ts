/**
 * ORD-RELEASED-GUARD, against real Postgres.
 *
 * Before this fix: once an admin released an order's reservations
 * (`Order.reservationsReleasedAt` set, payment already CANCELLED/returned —
 * `orders.service.ts`'s `releaseReservationsInTx`), nothing stopped the
 * vendor from continuing to prepare, ready, or collect the same order.
 * `markReady`/`markReadyForPickup` would still arm dispatch or issue a
 * pickup PIN for an order the customer was never going to pay for again.
 *
 * This suite proves each forward-motion entry point now refuses, by name,
 * once released — and walks the exact sequence named in the card: pay, admin
 * releases, vendor attempts to ready, attempt is refused.
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
