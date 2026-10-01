/**
 * Vendor location-level inventory + fulfilment-origin selection (BMPL-175,
 * Edward req 1) — integration against real Postgres.
 *
 * Covers: a vendor that never adopts per-location tracking experiences
 * nothing; adopting it for one product creates child rows and makes the
 * product-level aggregate honest; checkout picks an origin by AVAILABILITY
 * ONLY with isPrimary as the tie-break, never splitting one line across two
 * locations; reservation/release/finalize all follow the SAME row
 * (BMPL-256's lock discipline mirrored onto the child table, never a second
 * way to reserve); and a location cannot be deleted out from under an open
 * reservation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { InventoryService } from '../src/products/inventory.service';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let inventoryService: InventoryService;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

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
  return { cookies, vpId, userId: user.id as string };
}
async function createProduct(cookies: string[], fields: Record<string, unknown>) {
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ categoryId, ...fields });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function addLocation(cookies: string[], label: string, isPrimary = false) {
  const res = await request(ctx.server)
    .post('/api/vendor/profile/locations')
    .set('Cookie', cookies)
    .send({ label, addressLine1: `1 ${label} St`, city: 'Belize City', district: 'BELIZE', isPrimary });
  expect(res.status).toBe(201);
  return res.body.locations.find((l: { label: string }) => l.label === label).id as string;
}
const adjustAt = (cookies: string[], productId: string, locationId: string, delta: number) =>
  request(ctx.server)
    .post(`/api/vendor/products/${productId}/inventory/locations/${locationId}/adjust`)
    .set('Cookie', cookies)
    .send({ delta, reason: 'RESTOCK' });
const getLocations = (cookies: string[], productId: string) =>
  request(ctx.server).get(`/api/vendor/products/${productId}/inventory/locations`).set('Cookie', cookies);
const addToCart = (cookies: string[], body: Record<string, unknown>) => request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body);
const checkout = (cookies: string[], body: Record<string, unknown> = {}) => request(ctx.server).post('/api/checkout').set('Cookie', cookies).send(body);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: `Cat ${uniq()}` });
  categoryId = cat.body.id;
  inventoryService = ctx.app.get(InventoryService);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('one-location vendor experiences nothing (BMPL-175)', () => {
  it('a vendor who never adopts per-location tracking sees byte-identical behaviour', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v1loc_${s}@example.bz`, `OneLoc ${s}`);
    await addLocation(vendor.cookies, 'Only Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Widget', sku: `W-${s}`, priceMinor: 1000 });
    await request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);

    // Zero InventoryLocation rows exist — nothing was ever adopted.
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    const locRows = await ctx.prisma.inventoryLocation.count({ where: { inventoryId: inv.id } });
    expect(locRows).toBe(0);

    const customer = await registerCustomer(`v1cust_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    const res = await checkout(customer).expect(201);
    expect(res.body.vendorOrders[0].items[0].quantity).toBe(2);

    // Reserved on the PARENT row exactly as before this card; no child row created.
    const after = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.reserved).toBe(2);
    expect(await ctx.prisma.inventoryLocation.count({ where: { inventoryId: inv.id } })).toBe(0);

    const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: res.body.id } });
    expect(vo.originLocationId).toBeNull();
  });
});

describe('per-location stock (vendor management)', () => {
  it('first adjustment at a location adopts tracking for that product only; the aggregate becomes honest', async () => {
    const s = uniq();
    const vendor = await makeVendor(`v2loc_${s}@example.bz`, `TwoLoc ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop A', true);
    const locB = await addLocation(vendor.cookies, 'Shop B', false);
    const productId = await createProduct(vendor.cookies, { title: 'Split Stock', sku: `S-${s}`, priceMinor: 1000 });

    // Before adoption: the untouched product-level row, zero.
    let get = await request(ctx.server).get(`/api/vendor/products/${productId}/inventory`).set('Cookie', vendor.cookies);
    expect(get.body.product.quantity).toBe(0);

    await adjustAt(vendor.cookies, productId, locA, 6).expect(201);
    await adjustAt(vendor.cookies, productId, locB, 4).expect(201);

    const locs = await getLocations(vendor.cookies, productId).expect(200);
    const a = locs.body.find((l: { locationId: string }) => l.locationId === locA);
    const b = locs.body.find((l: { locationId: string }) => l.locationId === locB);
    expect(a).toMatchObject({ adopted: true, quantity: 6, isPrimary: true });
    expect(b).toMatchObject({ adopted: true, quantity: 4, isPrimary: false });

    // The product-level aggregate now reports the SUM across locations —
    // not the (untouched, still-zero) parent row's own columns.
    get = await request(ctx.server).get(`/api/vendor/products/${productId}/inventory`).set('Cookie', vendor.cookies);
    expect(get.body.product.quantity).toBe(10);
    expect(get.body.product.inStock).toBe(true);

    // A second, untouched product at the SAME vendor is completely unaffected.
    const other = await createProduct(vendor.cookies, { title: 'Untouched', sku: `U-${s}`, priceMinor: 500 });
    const otherLocs = await getLocations(vendor.cookies, other).expect(200);
    expect(otherLocs.body.every((l: { adopted: boolean }) => l.adopted === false)).toBe(true);
  });

  it('a location-tracked product with real stock stays visible to inStock search and hideOutOfStock (BMPL-175)', async () => {
    const s = uniq();
    const vendor = await makeVendor(`vis_${s}@example.bz`, `Vis ${s}`);
    await request(ctx.server).patch('/api/vendor/settings').set('Cookie', vendor.cookies).send({ hideOutOfStock: true }).expect(200);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: `Visible Stock ${s}`, sku: `VS-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 3).expect(201);

    // The parent Inventory row itself never moved off 0 — only the search
    // query proves the fix, not a direct read of that row.
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    expect(inv.quantity).toBe(0);

    const inStock = await request(ctx.server).get('/api/marketplace/products?inStock=true');
    expect(inStock.body.items.map((i: { title: string }) => i.title)).toContain(`Visible Stock ${s}`);

    // hideOutOfStock is on for this vendor — the product must still show.
    const listed = await request(ctx.server).get('/api/marketplace/products');
    expect(listed.body.items.map((i: { title: string }) => i.title)).toContain(`Visible Stock ${s}`);
  });

  it('refuses to adjust a location belonging to another vendor', async () => {
    const s = uniq();
    const a = await makeVendor(`xv_a_${s}@example.bz`, `XA ${s}`);
    const b = await makeVendor(`xv_b_${s}@example.bz`, `XB ${s}`);
    const locB = await addLocation(b.cookies, 'B Shop', true);
    const productId = await createProduct(a.cookies, { title: 'Cross Vendor', sku: `X-${s}`, priceMinor: 100 });
    await adjustAt(a.cookies, productId, locB, 5).expect(404);
  });

  it('a location-tracked VARIANT is aggregated too, on both the owner view and the public product page', async () => {
    const s = uniq();
    const vendor = await makeVendor(`vv_${s}@example.bz`, `VV ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: `Variant Stock ${s}`, sku: `VT-${s}`, priceMinor: 1000 });
    const opt = await request(ctx.server).post(`/api/vendor/products/${productId}/options`).set('Cookie', vendor.cookies).send({ name: 'Size', values: ['S'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies);
    const sizeS = view.body.options.find((o: { name: string }) => o.name === 'Size').values.find((v: { value: string }) => v.value === 'S').id as string;
    const variant = await request(ctx.server).post(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies).send({ optionValueIds: [sizeS], sku: `VT-${s}-S` }).expect(201);
    const variantId = variant.body.variants[0].id as string;

    await request(ctx.server)
      .post(`/api/vendor/products/${productId}/inventory/locations/${locA}/adjust?variantId=${variantId}`)
      .set('Cookie', vendor.cookies)
      .send({ delta: 7, reason: 'RESTOCK' })
      .expect(201);

    // Owner's own variant management view: aggregated, not the (stale, zero) parent row.
    const manage = await request(ctx.server).get(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies);
    expect(manage.body.variants.find((v: { id: string }) => v.id === variantId).quantity).toBe(7);

    // Public product page: same aggregation, reached through a completely
    // different code path (ProductsService.publicDetail → VariantsService.publicView).
    const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const detail = await request(ctx.server).get(`/api/marketplace/products/${prod.slug}`);
    const publicVariant = detail.body.variants.find((v: { id: string }) => v.id === variantId);
    expect(publicVariant.availability).toMatchObject({ inStock: true, available: 7 });
  });
});

describe('checkout fulfilment-origin selection (BMPL-175)', () => {
  it('picks the PRIMARY location when both can cover the line', async () => {
    const s = uniq();
    const vendor = await makeVendor(`ck1_${s}@example.bz`, `CK1 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Primary', true);
    const locB = await addLocation(vendor.cookies, 'Secondary', false);
    const productId = await createProduct(vendor.cookies, { title: 'Dual', sku: `D-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 5).expect(201);
    await adjustAt(vendor.cookies, productId, locB, 5).expect(201);

    const customer = await registerCustomer(`ck1c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    const res = await checkout(customer).expect(201);

    const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: res.body.id } });
    expect(vo.originLocationId).toBe(locA);

    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    const rowA = await ctx.prisma.inventoryLocation.findFirstOrThrow({ where: { inventoryId: inv.id, locationId: locA } });
    const rowB = await ctx.prisma.inventoryLocation.findFirstOrThrow({ where: { inventoryId: inv.id, locationId: locB } });
    expect(rowA.reserved).toBe(2);
    expect(rowB.reserved).toBe(0);
    // The parent row's OWN reserved column is untouched — the child row is
    // the source of truth once adopted, never double-booked against both.
    expect(inv.reserved).toBe(0);
  });

  it('falls through to a non-primary location when the primary cannot cover the line', async () => {
    const s = uniq();
    const vendor = await makeVendor(`ck2_${s}@example.bz`, `CK2 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Primary', true);
    const locB = await addLocation(vendor.cookies, 'Secondary', false);
    const productId = await createProduct(vendor.cookies, { title: 'Dual2', sku: `D2-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 1).expect(201); // not enough for qty 3
    await adjustAt(vendor.cookies, productId, locB, 5).expect(201);

    const customer = await registerCustomer(`ck2c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 3 }).expect(201);
    const res = await checkout(customer).expect(201);

    const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: res.body.id } });
    expect(vo.originLocationId).toBe(locB);
  });

  it('refuses rather than splitting one line across two locations', async () => {
    const s = uniq();
    const vendor = await makeVendor(`ck3_${s}@example.bz`, `CK3 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Primary', true);
    const locB = await addLocation(vendor.cookies, 'Secondary', false);
    const productId = await createProduct(vendor.cookies, { title: 'Dual3', sku: `D3-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 2).expect(201);
    await adjustAt(vendor.cookies, productId, locB, 2).expect(201);
    // Combined stock (4) covers qty 3, but no SINGLE location does.

    const customer = await registerCustomer(`ck3c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 3 }).expect(201);
    const res = await checkout(customer);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Not enough stock');

    // Nothing reserved anywhere — the whole transaction rolled back.
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    const rows = await ctx.prisma.inventoryLocation.findMany({ where: { inventoryId: inv.id } });
    expect(rows.every((r) => r.reserved === 0)).toBe(true);
  });
});

describe('release and finalize follow the recorded origin', () => {
  it('cancelling a location-tracked order releases the CHILD row, not the parent', async () => {
    const s = uniq();
    const vendor = await makeVendor(`rel1_${s}@example.bz`, `REL1 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Releasable', sku: `R-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 5).expect(201);

    const customer = await registerCustomer(`rel1c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    const res = await checkout(customer).expect(201);

    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    let rowA = await ctx.prisma.inventoryLocation.findFirstOrThrow({ where: { inventoryId: inv.id, locationId: locA } });
    expect(rowA.reserved).toBe(2);

    const cancel = await request(ctx.server).post(`/api/orders/${res.body.id}/cancel`).set('Cookie', customer).send({ reason: 'changed my mind' });
    expect(cancel.status).toBe(201);

    rowA = await ctx.prisma.inventoryLocation.findUniqueOrThrow({ where: { id: rowA.id } });
    expect(rowA.reserved).toBe(0);
    expect(rowA.quantity).toBe(5); // on-hand unaffected by a release
  });

  it('confirming pickup on a location-tracked PICKUP order finalizes the CHILD row exactly once', async () => {
    const s = uniq();
    const vendor = await makeVendor(`rel2_${s}@example.bz`, `REL2 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Pickupable', sku: `PU-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 5).expect(201);

    const customer = await registerCustomer(`rel2c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    const res = await checkout(customer).expect(201);
    const vendorOrderId = res.body.vendorOrders[0].id as string;

    await request(ctx.server).post(`/api/vendor/orders/${vendorOrderId}/ready-for-pickup`).set('Cookie', vendor.cookies).expect(201);
    const pinRes = await request(ctx.server).get(`/api/orders/vendor-orders/${vendorOrderId}/pickup-pin`).set('Cookie', customer).expect(200);
    await request(ctx.server)
      .post(`/api/vendor/orders/${vendorOrderId}/confirm-pickup`)
      .set('Cookie', vendor.cookies)
      .send({ pin: pinRes.body.pickupPin })
      .expect(201);

    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    const rowA = await ctx.prisma.inventoryLocation.findFirstOrThrow({ where: { inventoryId: inv.id, locationId: locA } });
    expect(rowA.quantity).toBe(3); // 5 on-hand - 2 finalized
    expect(rowA.reserved).toBe(0);
    // The parent row was never touched — the child row is the only bucket a
    // location-tracked product's stock ever lived in.
    expect(inv.quantity).toBe(0);
    expect(inv.reserved).toBe(0);
  });
});

describe('reservation concurrency at one location (BMPL-256, mirrored)', () => {
  it('two racers for the last unit at ONE location: exactly one reserves, the other is refused', async () => {
    const s = uniq();
    const vendor = await makeVendor(`race_${s}@example.bz`, `Race ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Racer', sku: `RC-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 1).expect(201);

    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    const row = await ctx.prisma.inventoryLocation.findFirstOrThrow({ where: { inventoryId: inv.id, locationId: locA } });

    const racerA = ctx.prisma.$transaction(async (tx) => {
      await inventoryService.reserveAtLocation(inv, row.id, 1, tx);
      await tx.$executeRaw`SELECT pg_sleep(0.3)`;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const racerB = ctx.prisma.$transaction(async (tx) => {
      await inventoryService.reserveAtLocation(inv, row.id, 1, tx);
    });

    const results = await Promise.allSettled([racerA, racerB]);
    const outcomes = results.map((r) => r.status);
    expect(outcomes.filter((x) => x === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((x) => x === 'rejected')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect((rejected.reason as Error).message).toBe('Insufficient stock to reserve.');

    const after = await ctx.prisma.inventoryLocation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.reserved).toBe(1);
    expect(after.quantity - after.reserved).toBe(0);
  });
});

describe('a location cannot be deleted out from under an open reservation', () => {
  it('refuses while reserved > 0; succeeds once released', async () => {
    const s = uniq();
    const vendor = await makeVendor(`del_${s}@example.bz`, `Del ${s}`);
    const locA = await addLocation(vendor.cookies, 'Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Deletable', sku: `DL-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 5).expect(201);

    const customer = await registerCustomer(`delc_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 2 }).expect(201);
    const res = await checkout(customer).expect(201);

    const refused = await request(ctx.server).delete(`/api/vendor/profile/locations/${locA}`).set('Cookie', vendor.cookies);
    expect(refused.status).toBe(409);

    await request(ctx.server).post(`/api/orders/${res.body.id}/cancel`).set('Cookie', customer).send({}).expect(201);

    const ok = await request(ctx.server).delete(`/api/vendor/profile/locations/${locA}`).set('Cookie', vendor.cookies);
    expect(ok.status).toBe(200);

    // Cascade: the child row is gone, and VendorOrder.originLocationId was
    // SET NULL, not left dangling.
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    expect(await ctx.prisma.inventoryLocation.count({ where: { inventoryId: inv.id, locationId: locA } })).toBe(0);
    const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: res.body.id } });
    expect(vo.originLocationId).toBeNull();
  });
});

describe('fulfilment origin is readable, not just recorded (BMPL-354)', () => {
  it('the customer, the owning vendor and admin each see {id, label} — never the address — through the one shared shaper', async () => {
    const s = uniq();
    const vendor = await makeVendor(`org1_${s}@example.bz`, `Org1 ${s}`);
    const locA = await addLocation(vendor.cookies, 'Front Counter', true);
    const productId = await createProduct(vendor.cookies, { title: 'Originful', sku: `OR-${s}`, priceMinor: 1000 });
    await adjustAt(vendor.cookies, productId, locA, 5).expect(201);

    const customer = await registerCustomer(`org1c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const checkoutRes = await checkout(customer).expect(201);
    const orderId = checkoutRes.body.id as string;
    const vendorOrderId = checkoutRes.body.vendorOrders[0].id as string;
    const expected = { id: locA, label: 'Front Counter' };

    // Audience 1: the customer who placed the order — the SAME checkout
    // response above already went through getOwn()/serializeOrder(), and a
    // later plain GET must agree with it.
    expect(checkoutRes.body.vendorOrders[0].originLocation).toEqual(expected);
    const customerGet = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(customerGet.body.vendorOrders[0].originLocation).toEqual(expected);

    // Audience 2: the owning vendor's own order detail.
    const vendorGet = await request(ctx.server).get(`/api/vendor/orders/${vendorOrderId}`).set('Cookie', vendor.cookies).expect(200);
    expect(vendorGet.body.originLocation).toEqual(expected);

    // Audience 3: admin (orders.read) order detail — the gap BMPL-354 opened on.
    const adminGetRes = await request(ctx.server).get(`/api/admin/orders/${orderId}`).set('Cookie', adminCookies).expect(200);
    expect(adminGetRes.body.vendorOrders[0].originLocation).toEqual(expected);

    // Named at the select (vendor.service.ts/BMPL-335 precedent): the address
    // this location was created with must never ride along.
    for (const body of [customerGet.body, adminGetRes.body]) {
      expect(JSON.stringify(body)).not.toContain('Front Counter St');
    }
  });

  it('reads as null, not a missing key, for an order with no recorded origin', async () => {
    const s = uniq();
    const vendor = await makeVendor(`org2_${s}@example.bz`, `Org2 ${s}`);
    await addLocation(vendor.cookies, 'Only Shop', true);
    const productId = await createProduct(vendor.cookies, { title: 'Originless', sku: `OL-${s}`, priceMinor: 1000 });
    // Adjusted at product level only — never adopts per-location tracking, so
    // chooseLocation() never runs and originLocationId stays null (same fixture
    // shape as 'one-location vendor experiences nothing' above).
    await request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);

    const customer = await registerCustomer(`org2c_${s}@example.bz`);
    await addToCart(customer, { productId, quantity: 1 }).expect(201);
    const checkoutRes = await checkout(customer).expect(201);
    expect(checkoutRes.body.vendorOrders[0].originLocation).toBeNull();

    const vendorOrderId = checkoutRes.body.vendorOrders[0].id as string;
    const vendorGet = await request(ctx.server).get(`/api/vendor/orders/${vendorOrderId}`).set('Cookie', vendor.cookies).expect(200);
    expect(vendorGet.body.originLocation).toBeNull();

    const adminGetRes = await request(ctx.server).get(`/api/admin/orders/${checkoutRes.body.id}`).set('Cookie', adminCookies).expect(200);
    expect(adminGetRes.body.vendorOrders[0].originLocation).toBeNull();
  });
});
