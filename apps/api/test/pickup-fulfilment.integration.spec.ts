/**
 * Pickup fulfilment (Phase 3 · M18.1) — integration vs real Postgres. Gives PICKUP
 * vendor-orders a real completion signal (READY_FOR_PICKUP → PICKED_UP) via a
 * customer-held / vendor-submitted PIN, finalizing inventory exactly once, with
 * ownership isolation, idempotency, attempt-capped PIN, and admin override. No
 * settlement/payment mutation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function register(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

interface Vendor { userId: string; cookies: string[]; vendorProfileId: string; productId: string; inventoryId: string }
async function makeVendor(): Promise<Vendor> {
  const s = uniq();
  const v = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({ data: { userId: v.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
  const product = await ctx.prisma.product.create({ data: { vendorProfileId: vp.id, categoryId, title: `P ${s}`, slug: `p-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } } });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  return { userId: v.userId, cookies: v.cookies, vendorProfileId: vp.id, productId: product.id, inventoryId: inv.id };
}

interface PickupOrder { vendorOrderId: string; orderId: string; customerId: string; customerCookies: string[] }
async function makePickupOrder(vendor: Vendor, qty = 2): Promise<PickupOrder> {
  const s = uniq();
  const cust = await register(`cust_${s}@example.bz`);
  await ctx.prisma.inventory.update({ where: { id: vendor.inventoryId }, data: { reserved: { increment: qty } } }); // checkout reserved it
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num, userId: cust.userId, status: 'PENDING', itemCount: qty, subtotalMinor: BigInt(1000 * qty), deliveryFeeMinor: 0n, totalMinor: BigInt(1000 * qty),
      vendorOrders: { create: { orderNumber: `${num}-1`, vendorProfileId: vendor.vendorProfileId, status: 'PENDING', deliveryMethod: 'PICKUP', itemCount: qty, subtotalMinor: BigInt(1000 * qty), items: { create: { productId: vendor.productId, productTitle: 'P', unitPriceMinor: 1000n, quantity: qty, subtotalMinor: BigInt(1000 * qty) } } } },
    },
    include: { vendorOrders: true },
  });
  return { vendorOrderId: order.vendorOrders[0]!.id, orderId: order.id, customerId: cust.userId, customerCookies: cust.cookies };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await post(adminCookies, 'admin/categories', { name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('pickup fulfilment', () => {
  it('vendor readies pickup → customer reveals PIN → vendor confirms → PICKED_UP + inventory finalized once', async () => {
    const vendor = await makeVendor();
    const o = await makePickupOrder(vendor, 2);
    const invBefore = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(invBefore.reserved).toBe(2);

    const ready = await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/ready-for-pickup`);
    expect(ready.status).toBe(201);
    expect(ready.body.status).toBe('READY_FOR_PICKUP');

    // customer sees their PIN; the vendor's order view must NOT expose it
    const pinRes = await get(o.customerCookies, `orders/vendor-orders/${o.vendorOrderId}/pickup-pin`);
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.pickupPin).toMatch(/^\d{4}$/);

    // wrong PIN rejected
    expect((await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin: '0000' })).status).toBe(400);
    // correct PIN → collected
    const done = await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin: pinRes.body.pickupPin });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('PICKED_UP');

    // inventory finalized exactly once (quantity − 2, reserved − 2, one FULFILLED change)
    const invAfter = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity - 2);
    expect(invAfter.reserved).toBe(0);
    expect(await ctx.prisma.inventoryChange.count({ where: { inventoryId: vendor.inventoryId, reason: 'FULFILLED' } })).toBe(1);

    // audit + notification
    expect(await ctx.prisma.auditLog.count({ where: { action: 'VENDOR_ORDER_PICKED_UP' } })).toBeGreaterThan(0);
    expect(await ctx.prisma.notificationRecipient.count({ where: { userId: o.customerId } })).toBeGreaterThan(0);
    // NO settlement created (boundary preserved)
    expect(await ctx.prisma.vendorSettlement.count({ where: { vendorOrderId: o.vendorOrderId } })).toBe(0);
  });

  it('confirmation is idempotent — a second confirm does not double-finalize inventory', async () => {
    const vendor = await makeVendor();
    const o = await makePickupOrder(vendor, 3);
    await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/ready-for-pickup`).expect(201);
    const pin = (await get(o.customerCookies, `orders/vendor-orders/${o.vendorOrderId}/pickup-pin`)).body.pickupPin;
    await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin }).expect(201);
    const invA = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    const again = await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin });
    expect(again.body.status).toBe('PICKED_UP'); // idempotent
    const invB = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: vendor.inventoryId } });
    expect(invB.quantity).toBe(invA.quantity);
    expect(await ctx.prisma.inventoryChange.count({ where: { inventoryId: vendor.inventoryId, reason: 'FULFILLED' } })).toBe(1);
  });

  it('enforces ownership + pickup-only + attempt cap; admin can override with a reason', async () => {
    const vendor = await makeVendor();
    const o = await makePickupOrder(vendor, 1);
    // another vendor cannot ready/confirm
    const other = await makeVendor();
    expect((await post(other.cookies, `vendor/orders/${o.vendorOrderId}/ready-for-pickup`)).status).toBe(404);
    // another customer cannot see the PIN
    const cust2 = await register(`c2_${uniq()}@example.bz`);
    await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/ready-for-pickup`).expect(201);
    expect((await get(cust2.cookies, `orders/vendor-orders/${o.vendorOrderId}/pickup-pin`)).status).toBe(404);
    // attempt cap: 5 wrong PINs → locked
    for (let i = 0; i < 5; i += 1) await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin: '0001' });
    const locked = await post(vendor.cookies, `vendor/orders/${o.vendorOrderId}/confirm-pickup`, { pin: '0001' });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/locked|too many/i);
    // admin override (orders.manage) confirms without the PIN, reason required
    expect((await post(adminCookies, `admin/orders/vendor-orders/${o.vendorOrderId}/confirm-pickup`, {})).status).toBe(400); // no reason
    const override = await post(adminCookies, `admin/orders/vendor-orders/${o.vendorOrderId}/confirm-pickup`, { reason: 'customer collected in person' });
    expect(override.status).toBe(201);
    expect(override.body.status).toBe('PICKED_UP');
    // a limited admin without orders.manage cannot override
    const ro = await seedLimitedAdmin(ctx.prisma, `ro_${uniq()}@example.bz`, ['orders.read']);
    const roC = await login(ro.email, ro.password);
    const o2 = await makePickupOrder(vendor, 1);
    await post(vendor.cookies, `vendor/orders/${o2.vendorOrderId}/ready-for-pickup`).expect(201);
    expect((await post(roC, `admin/orders/vendor-orders/${o2.vendorOrderId}/confirm-pickup`, { reason: 'x' })).status).toBe(403);
  });

  it('rejects readying a delivery order for pickup', async () => {
    const vendor = await makeVendor();
    const s = uniq();
    const cust = await register(`del_${s}@example.bz`);
    const num = `ORD-${s}`;
    const order = await ctx.prisma.order.create({
      data: { orderNumber: num, userId: cust.userId, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n, vendorOrders: { create: { orderNumber: `${num}-1`, vendorProfileId: vendor.vendorProfileId, status: 'PENDING', deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n } } },
      include: { vendorOrders: true },
    });
    expect((await post(vendor.cookies, `vendor/orders/${order.vendorOrders[0]!.id}/ready-for-pickup`)).status).toBe(400);
  });
});
