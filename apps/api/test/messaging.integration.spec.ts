/**
 * Messaging & Order Communication (Phase 4 · M17) — integration vs real Postgres +
 * MinIO. Context-scoped conversation creation + dedup, customer/vendor/driver/support
 * threads, participant isolation, reassignment (old driver loses send), closed-thread
 * policy, read/unread, notifications, private attachments + namespace authorization,
 * internal-note privacy, admin/support permissions, suspended-user denial, XSS-safe
 * text, and the no-side-effects invariant.
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

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'M', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

interface Vendor { vendorProfileId: string; vendorUserId: string; vendorCookies: string[]; productId: string; inventoryId: string }
async function makeVendor(): Promise<Vendor> {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({ where: { userId_roleCode: { userId, roleCode: 'VENDOR' } }, create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() }, update: { status: 'APPROVED' } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: { userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN', settings: { create: { deliveryEnabled: true, pickupEnabled: true } }, locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } } },
  });
  const product = await ctx.prisma.product.create({ data: { vendorProfileId: vp.id, categoryId, title: `P ${s}`, slug: `p-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } } });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  return { vendorProfileId: vp.id, vendorUserId: userId, vendorCookies: cookies, productId: product.id, inventoryId: inv.id };
}

interface DeliveryOrder { deliveryId: string; vendorOrderId: string; customerId: string; customerCookies: string[] }
async function makeDeliveryOrder(vendor: Vendor): Promise<DeliveryOrder> {
  const s = uniq();
  const { userId: customerId, cookies: customerCookies } = await registerCustomer(`cust_${s}@example.bz`);
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num, userId: customerId, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n,
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust', phone: '+501', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' } },
      vendorOrders: { create: { orderNumber: `${num}-1`, vendorProfileId: vendor.vendorProfileId, status: 'PENDING', deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, items: { create: { productId: vendor.productId, productTitle: 'P', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } }, delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n } } } },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  const vo = order.vendorOrders[0]!;
  return { deliveryId: vo.delivery!.id, vendorOrderId: vo.id, customerId, customerCookies };
}

interface Driver { cookies: string[]; userId: string; driverProfileId: string; vehicleId: string }
async function makeDriver(): Promise<Driver> {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({ where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } }, create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() }, update: { status: 'APPROVED' } });
  const p = await ctx.prisma.driverProfile.create({ data: { userId, legalName: 'D', displayName: `Drv${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true } });
  const v = await ctx.prisma.driverVehicle.create({ data: { driverProfileId: p.id, type: 'CAR', make: 'T', model: 'C', licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE, isActive: true, isPrimary: true, approvalStatus: 'APPROVED' } });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: p.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: p.id, vehicleId: v.id };
}
async function assign(deliveryId: string, driver: Driver) {
  expect((await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId })).status).toBe(201);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await ctx.prisma.category.create({ data: { name: 'Gen', slug: `gen-${uniq()}` } })).id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('conversation creation + isolation', () => {
  it('guest is 401', async () => {
    await request(ctx.server).get('/api/conversations').expect(401);
  });

  it('customer opens a vendor-order conversation; dedups; other customer + vendor isolated', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const c1 = await post(order.customerCookies, `conversations/vendor-order/${order.vendorOrderId}`);
    expect(c1.status).toBe(201);
    expect(c1.body.participants).toHaveLength(2);
    // dedup: same conversation id
    const c2 = await post(order.customerCookies, `conversations/vendor-order/${order.vendorOrderId}`);
    expect(c2.body.id).toBe(c1.body.id);
    // vendor can access
    expect((await get(vendor.vendorCookies, `conversations/${c1.body.id}`)).status).toBe(200);
    // another customer cannot
    const other = await registerCustomer(`other_${uniq()}@example.bz`);
    expect((await get(other.cookies, `conversations/${c1.body.id}`)).status).toBe(404);
    // another vendor cannot open/access it
    const vendor2 = await makeVendor();
    expect((await post(vendor2.vendorCookies, `conversations/vendor-order/${order.vendorOrderId}`)).status).toBe(404);
  });

  it('cannot open a delivery conversation before a driver is assigned', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    expect((await post(order.customerCookies, `conversations/delivery/${order.deliveryId}`)).status).toBe(400);
  });
});

describe('messaging + read state + notifications', () => {
  it('customer↔vendor exchange, unread counts, mark read, ordering', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const conv = (await post(order.customerCookies, `conversations/vendor-order/${order.vendorOrderId}`)).body;
    await post(order.customerCookies, `conversations/${conv.id}/messages`, { body: 'Hello, where is my order?' });
    await post(vendor.vendorCookies, `conversations/${conv.id}/messages`, { body: 'Preparing it now.' });
    // vendor unread should include the customer message (not their own)
    const vendorConv = await get(vendor.vendorCookies, `conversations/${conv.id}`);
    const userMsgs = vendorConv.body.messages.filter((m: { type: string }) => m.type === 'USER');
    expect(userMsgs.map((m: { body: string }) => m.body)).toEqual(['Hello, where is my order?', 'Preparing it now.']);
    // customer has 1 unread (vendor's reply); mark read clears it
    const cnt1 = await get(order.customerCookies, 'conversations/unread-count');
    expect(cnt1.body.count).toBeGreaterThanOrEqual(1);
    await post(order.customerCookies, `conversations/${conv.id}/read`);
    expect((await get(order.customerCookies, 'conversations/unread-count')).body.count).toBe(0);
    // a MESSAGE notification was created for the recipient(s)
    expect(await ctx.prisma.notificationRecipient.count({ where: { notification: { category: 'MESSAGE' } } })).toBeGreaterThan(0);
  });

  it('message body is stored as text (control chars stripped; script not executed)', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const conv = (await post(order.customerCookies, `conversations/vendor-order/${order.vendorOrderId}`)).body;
    const res = await post(order.customerCookies, `conversations/${conv.id}/messages`, { body: '<script>alert(1)</script>  hi' });
    const last = res.body.messages.filter((m: { type: string }) => m.type === 'USER').pop();
    expect(last.body).toBe('<script>alert(1)</script> hi'); // null stripped, stored verbatim as text
  });
});

describe('delivery conversations + reassignment', () => {
  it('customer↔driver works; reassigned driver loses send but keeps read; new driver sends', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver1 = await makeDriver();
    await assign(order.deliveryId, driver1);
    const conv = (await post(order.customerCookies, `conversations/delivery/${order.deliveryId}`)).body;
    expect(conv.pairing).toBe('CUSTOMER_DRIVER');
    // driver1 can send
    expect((await post(driver1.cookies, `conversations/${conv.id}/messages`, { body: 'On my way' })).status).toBe(201);
    // reassign to driver2
    const driver2 = await makeDriver();
    expect((await post(adminCookies, `admin/deliveries/${order.deliveryId}/reassign`, { driverProfileId: driver2.driverProfileId, vehicleId: driver2.vehicleId, reason: 'swap' })).status).toBe(201);
    // driver1 can still READ history but CANNOT send
    expect((await get(driver1.cookies, `conversations/${conv.id}`)).status).toBe(200);
    expect((await post(driver1.cookies, `conversations/${conv.id}/messages`, { body: 'still here?' })).status).toBe(403);
    // driver2 (current) can send
    expect((await post(driver2.cookies, `conversations/${conv.id}/messages`, { body: 'I took over' })).status).toBe(201);
  });

  it('vendor↔driver pickup thread is not visible to the customer', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver();
    await assign(order.deliveryId, driver);
    const vd = (await post(vendor.vendorCookies, `conversations/delivery/${order.deliveryId}`)).body;
    expect(vd.pairing).toBe('VENDOR_DRIVER');
    await post(vendor.vendorCookies, `conversations/${vd.id}/messages`, { body: 'Order ready at counter 3' });
    // the customer must NOT be able to read the vendor↔driver thread
    expect((await get(order.customerCookies, `conversations/${vd.id}`)).status).toBe(404);
  });
});

describe('support + internal notes + close', () => {
  it('customer opens support, support joins + replies, internal note stays private, close blocks send', async () => {
    const s = uniq();
    const cust = await registerCustomer(`sup_${s}@example.bz`);
    const open = await post(cust.cookies, 'conversations/support', { subject: 'Where is my refund policy?', message: 'I have a question.' });
    expect(open.status).toBe(201);
    const convId = open.body.id;
    // super-admin has support.read + support.respond
    const list = await get(adminCookies, 'admin/support');
    expect(list.status).toBe(200);
    expect(list.body.some((c: { id: string }) => c.id === convId)).toBe(true);
    await post(adminCookies, `admin/support/${convId}/join`);
    await post(adminCookies, `admin/support/${convId}/messages`, { body: 'Happy to help!' });
    await post(adminCookies, `admin/support/${convId}/notes`, { body: 'INTERNAL: check tier-2 policy' });
    // customer sees the support reply but NOT the internal note
    const custView = await get(cust.cookies, `conversations/${convId}`);
    const bodies = custView.body.messages.map((m: { body: string }) => m.body);
    expect(bodies).toContain('Happy to help!');
    expect(custView.body.messages.some((m: { type: string }) => m.type === 'INTERNAL_NOTE')).toBe(false);
    expect(bodies.some((b: string) => b.includes('INTERNAL'))).toBe(false);
    // admin view DOES include the internal note
    const adminView = await get(adminCookies, `admin/support/${convId}`);
    expect(adminView.body.messages.some((m: { type: string }) => m.type === 'INTERNAL_NOTE')).toBe(true);
    // close → customer can no longer send
    await post(adminCookies, `admin/support/${convId}/close`);
    expect((await post(cust.cookies, `conversations/${convId}/messages`, { body: 'one more' })).status).toBe(403);
  });

  it('support endpoints require the support permission', async () => {
    const noPerm = await seedLimitedAdmin(ctx.prisma, `nosup_${uniq()}@example.bz`, ['orders.read']);
    const npCookies = await login(noPerm.email, noPerm.password);
    expect((await get(npCookies, 'admin/support')).status).toBe(403);
  });
});

describe('attachments + security invariants', () => {
  it('private attachment upload + view; foreign-namespace key rejected', async () => {
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const conv = (await post(order.customerCookies, `conversations/vendor-order/${order.vendorOrderId}`)).body;
    // invalid MIME at presign
    expect((await post(order.customerCookies, 'conversations/attachments/presign', { fileName: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 10 })).status).toBe(400);
    // valid presign → PUT → send
    const presign = await post(order.customerCookies, 'conversations/attachments/presign', { fileName: 'issue.jpg', contentType: 'image/jpeg', sizeBytes: 4 });
    expect(presign.status).toBe(201);
    expect(await putToPresigned(presign.body.uploadUrl, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBe(200);
    const sent = await post(order.customerCookies, `conversations/${conv.id}/messages`, { body: 'See photo', attachmentKeys: [presign.body.key] });
    expect(sent.status).toBe(201);
    const withAtt = sent.body.messages.find((m: { attachments: unknown[] }) => m.attachments.length > 0);
    expect(withAtt.attachments[0].url).toBeTruthy();
    // referencing another user's namespace is rejected
    expect((await post(vendor.vendorCookies, `conversations/${conv.id}/messages`, { body: 'x', attachmentKeys: [presign.body.key] })).status).toBe(400);
  });

  it('suspended user cannot send; messaging changes no delivery/wallet state', async () => {
    const ledgerBefore = await ctx.prisma.walletLedgerEntry.count();
    const vendor = await makeVendor();
    const order = await makeDeliveryOrder(vendor);
    const driver = await makeDriver();
    await assign(order.deliveryId, driver);
    const conv = (await post(order.customerCookies, `conversations/delivery/${order.deliveryId}`)).body;
    await post(order.customerCookies, `conversations/${conv.id}/messages`, { body: 'hi' });
    // delivery status unchanged by messaging
    const d = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: order.deliveryId } });
    expect(d.status).toBe('ASSIGNED');
    // no wallet movement
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(ledgerBefore);
    // suspend the customer → send denied
    await ctx.prisma.user.update({ where: { id: order.customerId }, data: { status: 'SUSPENDED' } });
    const res = await post(order.customerCookies, `conversations/${conv.id}/messages`, { body: 'blocked?' });
    expect([401, 403]).toContain(res.status);
    await ctx.prisma.user.update({ where: { id: order.customerId }, data: { status: 'ACTIVE' } });
  });
});
