/**
 * Checkout & orders (Phase 3 · M10) — integration against real Postgres.
 * Transactional cart→order conversion, inventory reservation (+ rollback),
 * multi-vendor split, server-side price snapshots, and authorization/ownership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<string[]> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return cookiesOf(reg);
}
async function makeVendor(email: string, business: string) {
  const cookies = await registerCustomer(email);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await request(ctx.server).post('/api/vendor/profile').set('Cookie', cookies).send({ businessName: business, contactEmail: email });
  const vpId = profile.body.profile.id;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId };
}
async function createProduct(cookies: string[], fields: Record<string, unknown>) {
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ categoryId, ...fields });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const setStock = (cookies: string[], productId: string, delta: number) =>
  request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', cookies).send({ delta, reason: 'RESTOCK' }).expect(201);
const addToCart = (cookies: string[], body: Record<string, unknown>) =>
  request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body);
const checkout = (cookies: string[], body: Record<string, unknown> = {}) =>
  request(ctx.server).post('/api/checkout').set('Cookie', cookies).send(body);
const getCart = (cookies: string[]) => request(ctx.server).get('/api/cart').set('Cookie', cookies);
const reservedFor = async (productId: string) =>
  (await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } })).reserved;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'General' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('successful checkout', () => {
  let customer: string[];
  let vendor: Awaited<ReturnType<typeof makeVendor>>;
  let productId: string;
  let orderId: string;

  it('converts the cart into a PENDING order, reserves inventory, snapshots prices, clears the cart', async () => {
    customer = await registerCustomer('ord_c1@example.bz');
    vendor = await makeVendor('ord_v1@example.bz', 'Shop One');
    productId = await createProduct(vendor.cookies, { title: 'Widget', sku: 'W1', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);

    const res = await checkout(customer).expect(201);
    orderId = res.body.id;
    expect(res.body.status).toBe('PENDING');
    expect(res.body.itemCount).toBe(2);
    expect(res.body.subtotalMinor).toBe(2000);
    expect(res.body.totalMinor).toBe(2000); // no tax/shipping/fees in M10
    expect(res.body.vendorOrders).toHaveLength(1);
    const vo = res.body.vendorOrders[0];
    expect(vo.status).toBe('PENDING');
    expect(vo.deliveryMethod).toBe('PICKUP');
    expect(vo.items[0]).toMatchObject({ productTitle: 'Widget', unitPriceMinor: 1000, quantity: 2, subtotalMinor: 2000 });

    // inventory RESERVED (not decremented from on-hand)
    expect(await reservedFor(productId)).toBe(2);

    // cart cleared
    const cart = await getCart(customer).expect(200);
    expect(cart.body.itemCount).toBe(0);
  });

  it('keeps the price SNAPSHOT even after the product price later changes', async () => {
    await request(ctx.server).patch(`/api/vendor/products/${productId}`).set('Cookie', vendor.cookies).send({ priceMinor: 9999 }).expect(200);
    const detail = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(detail.body.vendorOrders[0].items[0].unitPriceMinor).toBe(1000); // snapshot, not 9999
  });

  it('lists the order for the customer', async () => {
    const list = await request(ctx.server).get('/api/orders').set('Cookie', customer).expect(200);
    expect(list.body.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });
});

describe('multi-vendor split + delivery', () => {
  it('creates one vendor order per storefront with its own delivery method and subtotal', async () => {
    const customer = await registerCustomer('ord_c2@example.bz');
    const a = await makeVendor('ord_v2a@example.bz', 'Alpha');
    const b = await makeVendor('ord_v2b@example.bz', 'Beta');
    // Beta offers delivery (M13: a DELIVERY choice requires the store to offer it).
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', b.cookies).send({ deliveryEnabled: true, baseDeliveryFeeMinor: 500 });
    const pa = await createProduct(a.cookies, { title: 'Prod A', sku: 'A1', priceMinor: 1000 });
    const pb = await createProduct(b.cookies, { title: 'Prod B', sku: 'B1', priceMinor: 2000 });
    await setStock(b.cookies, pb, 10);
    await addToCart(customer, { productId: pa, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: pb, quantity: 2 }).expect(201);

    const res = await checkout(customer, {
      vendors: [
        { vendorProfileId: a.vpId, deliveryMethod: 'PICKUP' },
        { vendorProfileId: b.vpId, deliveryMethod: 'DELIVERY', customerNotes: 'Leave at door' },
      ],
      deliveryAddress: { fullName: 'C U', addressLine1: '1 Main St', city: 'Belize City', district: 'BELIZE' },
    }).expect(201);

    expect(res.body.vendorOrders).toHaveLength(2);
    expect(res.body.subtotalMinor).toBe(5000);
    const alpha = res.body.vendorOrders.find((v: { vendor: { businessName: string } }) => v.vendor.businessName === 'Alpha');
    const beta = res.body.vendorOrders.find((v: { vendor: { businessName: string } }) => v.vendor.businessName === 'Beta');
    expect(alpha.deliveryMethod).toBe('PICKUP');
    expect(alpha.subtotalMinor).toBe(1000);
    expect(beta.deliveryMethod).toBe('DELIVERY');
    expect(beta.customerNotes).toBe('Leave at door');
    expect(beta.subtotalMinor).toBe(4000);
    expect(res.body.deliveryAddress).toMatchObject({ addressLine1: '1 Main St', district: 'BELIZE' });
    expect(await reservedFor(pb)).toBe(2);
  });

  it('rejects a delivery order without an address', async () => {
    const customer = await registerCustomer('ord_c2b@example.bz');
    const v = await makeVendor('ord_v2c@example.bz', 'Gamma');
    const p = await createProduct(v.cookies, { title: 'Prod G', sku: 'G1', priceMinor: 1000 });
    await addToCart(customer, { productId: p, quantity: 1 }).expect(201);
    const res = await checkout(customer, { vendors: [{ vendorProfileId: v.vpId, deliveryMethod: 'DELIVERY' }] });
    expect(res.status).toBe(400);
    // rolled back: cart intact
    expect((await getCart(customer)).body.itemCount).toBe(1);
  });
});

describe('validation + transactional rollback', () => {
  it('rejects an empty cart', async () => {
    const customer = await registerCustomer('ord_empty@example.bz');
    const res = await checkout(customer);
    expect(res.status).toBe(400);
  });

  it('rejects an unpublished product and rolls everything back', async () => {
    const customer = await registerCustomer('ord_unpub@example.bz');
    const v = await makeVendor('ord_vunpub@example.bz', 'UnpubShop');
    const p = await createProduct(v.cookies, { title: 'Vanishing', sku: 'VAN', priceMinor: 1000 });
    await setStock(v.cookies, p, 5);
    await addToCart(customer, { productId: p, quantity: 1 }).expect(201);
    await request(ctx.server).post(`/api/vendor/products/${p}/archive`).set('Cookie', v.cookies).expect(201);

    const res = await checkout(customer);
    expect(res.status).toBe(409);
    expect(await reservedFor(p)).toBe(0); // no reservation persisted
    expect((await getCart(customer)).body.itemCount).toBe(1); // cart intact
    expect(await ctx.prisma.order.count({ where: { user: { email: 'ord_unpub@example.bz' } } })).toBe(0);
  });

  it('rejects an inactive storefront', async () => {
    const customer = await registerCustomer('ord_susp@example.bz');
    const v = await makeVendor('ord_vsusp@example.bz', 'SuspShop');
    const p = await createProduct(v.cookies, { title: 'Prod S', sku: 'S1', priceMinor: 1000 });
    await addToCart(customer, { productId: p, quantity: 1 }).expect(201);
    await ctx.prisma.vendorProfile.update({ where: { id: v.vpId }, data: { approvalStatus: 'SUSPENDED' } });
    expect((await checkout(customer)).status).toBe(409);
  });

  it('rejects insufficient inventory (stock dropped after add) and rolls back', async () => {
    const customer = await registerCustomer('ord_stock@example.bz');
    const v = await makeVendor('ord_vstock@example.bz', 'StockShop');
    const p = await createProduct(v.cookies, { title: 'Limited', sku: 'LIM', priceMinor: 1000 });
    await setStock(v.cookies, p, 5);
    await addToCart(customer, { productId: p, quantity: 3 }).expect(201);
    await setStock(v.cookies, p, -4); // now only 1 on hand, cart wants 3
    const res = await checkout(customer);
    expect(res.status).toBe(409);
    expect(await reservedFor(p)).toBe(0);
    expect((await getCart(customer)).body.itemCount).toBe(3); // qty 3 preserved on rollback
  });

  it('rolls back an earlier item’s reservation when a later item fails', async () => {
    const customer = await registerCustomer('ord_multi@example.bz');
    const v = await makeVendor('ord_vmulti@example.bz', 'MultiShop');
    const p1 = await createProduct(v.cookies, { title: 'First', sku: 'F1', priceMinor: 1000 });
    const p2 = await createProduct(v.cookies, { title: 'Second', sku: 'S2', priceMinor: 1000 });
    await setStock(v.cookies, p1, 5);
    await setStock(v.cookies, p2, 5);
    await addToCart(customer, { productId: p1, quantity: 1 }).expect(201);
    await addToCart(customer, { productId: p2, quantity: 1 }).expect(201);
    await request(ctx.server).post(`/api/vendor/products/${p2}/archive`).set('Cookie', v.cookies).expect(201); // second fails

    expect((await checkout(customer)).status).toBe(409);
    expect(await reservedFor(p1)).toBe(0); // first item's reservation rolled back
    expect(await reservedFor(p2)).toBe(0);
    expect((await getCart(customer)).body.itemCount).toBe(2);
  });

  it('rejects a disabled variant', async () => {
    const customer = await registerCustomer('ord_var@example.bz');
    const v = await makeVendor('ord_vvar@example.bz', 'VarShop');
    const p = await createProduct(v.cookies, { title: 'Tee', sku: 'TEE', priceMinor: 1000 });
    await request(ctx.server).post(`/api/vendor/products/${p}/options`).set('Cookie', v.cookies).send({ name: 'Size', values: ['S'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${p}/variants`).set('Cookie', v.cookies);
    const sizeS = view.body.options[0].values[0].id;
    const created = await request(ctx.server).post(`/api/vendor/products/${p}/variants`).set('Cookie', v.cookies).send({ optionValueIds: [sizeS], sku: 'TEE-S', quantity: 5 }).expect(201);
    const variantId = created.body.variants[0].id;
    await addToCart(customer, { productId: p, variantId, quantity: 1 }).expect(201);
    await request(ctx.server).patch(`/api/vendor/products/${p}/variants/${variantId}`).set('Cookie', v.cookies).send({ isActive: false }).expect(200);
    expect((await checkout(customer)).status).toBe(409);
  });
});

describe('authorization, ownership + isolation', () => {
  it('requires authentication', async () => {
    await request(ctx.server).post('/api/checkout').send({}).expect(401);
    await request(ctx.server).get('/api/orders').expect(401);
    await request(ctx.server).get('/api/vendor/orders').expect(401);
    await request(ctx.server).get('/api/admin/orders').expect(401);
  });

  it('enforces roles/permissions on vendor + admin order routes', async () => {
    const customer = await registerCustomer('ord_role@example.bz');
    await request(ctx.server).get('/api/vendor/orders').set('Cookie', customer).expect(403); // not a vendor
    await request(ctx.server).get('/api/admin/orders').set('Cookie', customer).expect(403); // no orders.read
    await request(ctx.server).get('/api/admin/orders').set('Cookie', adminCookies).expect(200); // super-admin
  });

  it('isolates orders across customers and vendor orders across vendors', async () => {
    const c1 = await registerCustomer('ord_iso_c1@example.bz');
    const c2 = await registerCustomer('ord_iso_c2@example.bz');
    const vendorA = await makeVendor('ord_iso_va@example.bz', 'IsoA');
    const vendorB = await makeVendor('ord_iso_vb@example.bz', 'IsoB');
    const pa = await createProduct(vendorA.cookies, { title: 'IA', sku: 'IA1', priceMinor: 1000 });
    await setStock(vendorA.cookies, pa, 5);
    await addToCart(c1, { productId: pa, quantity: 1 }).expect(201);
    const order = (await checkout(c1).expect(201)).body;
    const vendorOrderId = order.vendorOrders[0].id;

    // customer isolation
    await request(ctx.server).get(`/api/orders/${order.id}`).set('Cookie', c2).expect(404);
    await request(ctx.server).get(`/api/orders/${order.id}`).set('Cookie', c1).expect(200);

    // vendor isolation
    await request(ctx.server).get(`/api/vendor/orders/${vendorOrderId}`).set('Cookie', vendorB.cookies).expect(404);
    const ownView = await request(ctx.server).get(`/api/vendor/orders/${vendorOrderId}`).set('Cookie', vendorA.cookies).expect(200);
    expect(ownView.body.customerName).toBeTruthy();

    // vendor A sees exactly their own vendor order; B sees none of A's
    const aList = await request(ctx.server).get('/api/vendor/orders').set('Cookie', vendorA.cookies).expect(200);
    expect(aList.body.some((v: { id: string }) => v.id === vendorOrderId)).toBe(true);
    const bList = await request(ctx.server).get('/api/vendor/orders').set('Cookie', vendorB.cookies).expect(200);
    expect(bList.body.some((v: { id: string }) => v.id === vendorOrderId)).toBe(false);
  });
});

describe('M10.1 — reservation release (admin operational)', () => {
  let customer: string[];
  let vendor: Awaited<ReturnType<typeof makeVendor>>;
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    customer = await registerCustomer('rel_c@example.bz');
    vendor = await makeVendor('rel_v@example.bz', 'RelShop');
    productId = await createProduct(vendor.cookies, { title: 'Releasable', sku: 'REL', priceMinor: 1000 });
    await setStock(vendor.cookies, productId, 5);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    orderId = (await checkout(customer).expect(201)).body.id;
  });

  const release = (cookie: string[]) =>
    request(ctx.server).post(`/api/admin/orders/${orderId}/release-reservations`).set('Cookie', cookie);

  it('reserves on checkout, then releases via the admin endpoint (restores stock)', async () => {
    expect(await reservedFor(productId)).toBe(2);
    const res = await release(adminCookies).expect(201);
    expect(res.body).toMatchObject({ released: true, alreadyReleased: false, itemsReleased: 1 });
    expect(await reservedFor(productId)).toBe(0); // reserved restored
  });

  it('is idempotent — a second release is a no-op and never over-releases', async () => {
    const res = await release(adminCookies).expect(201);
    expect(res.body).toMatchObject({ released: false, alreadyReleased: true, itemsReleased: 0 });
    expect(await reservedFor(productId)).toBe(0);
  });

  it('leaves the historical order intact (no customer cancellation)', async () => {
    const detail = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(detail.body.status).toBe('PENDING');
    expect(detail.body.vendorOrders[0].items[0].quantity).toBe(2);
  });

  it('requires orders.manage (anon 401, customer 403, read-only admin 403)', async () => {
    await request(ctx.server).post(`/api/admin/orders/${orderId}/release-reservations`).expect(401);
    await release(customer).expect(403);
    const ro = await seedLimitedAdmin(ctx.prisma, 'rel_ro@example.bz', ['orders.read']);
    const roCookies = await login(ro.email, ro.password);
    await request(ctx.server).get('/api/admin/orders').set('Cookie', roCookies).expect(200); // read allowed
    await release(roCookies).expect(403); // manage denied
  });
});
