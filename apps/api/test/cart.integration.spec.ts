/**
 * Shopping cart (Phase 3 · M9) — integration against real Postgres.
 * One active cart per customer; product/variant lines; merge-on-duplicate;
 * server-authoritative pricing + price-change detection; availability checks
 * (unlimited / backorder / insufficient); multi-vendor grouping; ownership
 * isolation; and authentication/authorization/validation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function registerCustomer(email: string): Promise<string[]> {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
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
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send(fields);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function adjustStock(cookies: string[], productId: string, delta: number, variantId?: string) {
  const url = `/api/vendor/products/${productId}/inventory/adjust${variantId ? `?variantId=${variantId}` : ''}`;
  await request(ctx.server).post(url).set('Cookie', cookies).send({ delta, reason: 'RESTOCK' }).expect(201);
}

async function patchInventory(cookies: string[], productId: string, body: Record<string, unknown>) {
  await request(ctx.server).patch(`/api/vendor/products/${productId}/inventory`).set('Cookie', cookies).send(body).expect(200);
}

const getCart = (cookies: string[]) => request(ctx.server).get('/api/cart').set('Cookie', cookies);
const addItem = (cookies: string[], body: Record<string, unknown>) =>
  request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body);

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

describe('cart lifecycle (create, add, update, remove, clear)', () => {
  let customer: string[];
  let productId: string;
  let vendor: Awaited<ReturnType<typeof makeVendor>>;

  it('creates exactly one active cart per customer', async () => {
    customer = await registerCustomer('cart_c1@example.bz');
    const a = await getCart(customer).expect(200);
    expect(a.body.vendors).toEqual([]);
    expect(a.body.itemCount).toBe(0);
    const b = await getCart(customer).expect(200);
    expect(b.body.id).toBe(a.body.id); // same cart, not a new one
    const count = await ctx.prisma.cart.count({ where: { user: { email: 'cart_c1@example.bz' } } });
    expect(count).toBe(1);
  });

  it('adds a product without a variant', async () => {
    vendor = await makeVendor('cart_v1@example.bz', 'Shop One');
    productId = await createProduct(vendor.cookies, { title: 'Basic Widget', sku: 'BW1', categoryId, priceMinor: 2500 });
    const res = await addItem(customer, { productId, quantity: 2 }).expect(201);
    expect(res.body.itemCount).toBe(2);
    expect(res.body.vendors).toHaveLength(1);
    const line = res.body.vendors[0].items[0];
    expect(line.quantity).toBe(2);
    expect(line.unitPriceMinor).toBe(2500);
    expect(line.lineSubtotalMinor).toBe(5000);
    expect(res.body.subtotalMinor).toBe(5000);
    expect(line.issues).toEqual([]);
    expect(line.purchasable).toBe(true);
  });

  it('merges a duplicate addition onto the same line', async () => {
    const res = await addItem(customer, { productId, quantity: 3 }).expect(201);
    expect(res.body.vendors[0].items).toHaveLength(1); // merged, not a second line
    expect(res.body.vendors[0].items[0].quantity).toBe(5);
    expect(res.body.itemCount).toBe(5);
  });

  it('does not reserve inventory when adding to the cart', async () => {
    // touch inventory so a row exists, then confirm reserved stays 0 after adds
    await adjustStock(vendor.cookies, productId, 100);
    await addItem(customer, { productId, quantity: 1 }).expect(201);
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId, variantId: null } });
    expect(inv.reserved).toBe(0);
  });

  it('updates a line quantity', async () => {
    const cart = await getCart(customer).expect(200);
    const itemId = cart.body.vendors[0].items[0].id;
    const res = await request(ctx.server).patch(`/api/cart/items/${itemId}`).set('Cookie', customer).send({ quantity: 4 }).expect(200);
    expect(res.body.vendors[0].items[0].quantity).toBe(4);
    expect(res.body.itemCount).toBe(4);
  });

  it('removes a line', async () => {
    const cart = await getCart(customer).expect(200);
    const itemId = cart.body.vendors[0].items[0].id;
    const res = await request(ctx.server).delete(`/api/cart/items/${itemId}`).set('Cookie', customer).expect(200);
    expect(res.body.vendors).toEqual([]);
    expect(res.body.itemCount).toBe(0);
  });

  it('clears the cart', async () => {
    await addItem(customer, { productId, quantity: 2 }).expect(201);
    const res = await request(ctx.server).delete('/api/cart').set('Cookie', customer).expect(200);
    expect(res.body.itemCount).toBe(0);
    expect(res.body.vendors).toEqual([]);
  });
});

describe('variants', () => {
  let customer: string[];
  let vendor: Awaited<ReturnType<typeof makeVendor>>;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    customer = await registerCustomer('cart_c2@example.bz');
    vendor = await makeVendor('cart_v2@example.bz', 'Shop Two');
    productId = await createProduct(vendor.cookies, { title: 'Tee', sku: 'TEE', categoryId, priceMinor: 4000 });
    await request(ctx.server).post(`/api/vendor/products/${productId}/options`).set('Cookie', vendor.cookies).send({ name: 'Size', values: ['S', 'M'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies);
    const sizeS = view.body.options[0].values.find((v: { value: string }) => v.value === 'S').id;
    const created = await request(ctx.server).post(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies).send({ optionValueIds: [sizeS], sku: 'TEE-S', quantity: 5, priceMinor: 4500 }).expect(201);
    variantId = created.body.variants[0].id;
  });

  it('rejects a missing variant when the product has variants', async () => {
    const res = await addItem(customer, { productId, quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid variant id', async () => {
    const res = await addItem(customer, { productId, variantId: 'clabcabcabcabcabcabcabca', quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('adds a valid variant at the variant price', async () => {
    const res = await addItem(customer, { productId, variantId, quantity: 2 }).expect(201);
    const line = res.body.vendors[0].items[0];
    expect(line.variantId).toBe(variantId);
    expect(line.unitPriceMinor).toBe(4500); // variant override, not the 4000 product price
    expect(line.variantLabel).toBe('S');
    expect(line.lineSubtotalMinor).toBe(9000);
  });
});

describe('availability rules', () => {
  let customer: string[];
  let vendor: Awaited<ReturnType<typeof makeVendor>>;

  beforeAll(async () => {
    customer = await registerCustomer('cart_c3@example.bz');
    vendor = await makeVendor('cart_v3@example.bz', 'Shop Three');
  });

  it('rejects more than the available stock', async () => {
    const p = await createProduct(vendor.cookies, { title: 'Limited', sku: 'LIM', categoryId, priceMinor: 1000 });
    await adjustStock(vendor.cookies, p, 3);
    const res = await addItem(customer, { productId: p, quantity: 5 });
    expect(res.status).toBe(409);
    // and merging past the limit is also rejected
    await addItem(customer, { productId: p, quantity: 3 }).expect(201);
    const over = await addItem(customer, { productId: p, quantity: 1 });
    expect(over.status).toBe(409);
  });

  it('respects unlimited inventory', async () => {
    const p = await createProduct(vendor.cookies, { title: 'Unlimited', sku: 'UNL', categoryId, priceMinor: 1000 });
    await patchInventory(vendor.cookies, p, { unlimited: true });
    const res = await addItem(customer, { productId: p, quantity: 9999 }).expect(201);
    const line = res.body.vendors[0].items.find((i: { productId: string }) => i.productId === p);
    expect(line.quantity).toBe(9999);
    expect(line.available).toBeNull(); // unlimited
    expect(line.inStock).toBe(true);
  });

  it('respects backorders (in stock at zero on-hand)', async () => {
    const p = await createProduct(vendor.cookies, { title: 'Backorder', sku: 'BKO', categoryId, priceMinor: 1000 });
    await request(ctx.server).get(`/api/vendor/products/${p}/inventory`).set('Cookie', vendor.cookies).expect(200); // create row at 0
    await patchInventory(vendor.cookies, p, { allowBackorders: true });
    const res = await addItem(customer, { productId: p, quantity: 4 }).expect(201);
    const line = res.body.vendors[0].items.find((i: { productId: string }) => i.productId === p);
    expect(line.quantity).toBe(4);
    expect(line.issues).toEqual([]);
  });
});

describe('server-authoritative pricing + price-change detection', () => {
  it('recomputes the current price and flags a change vs the stored snapshot', async () => {
    const customer = await registerCustomer('cart_c4@example.bz');
    const vendor = await makeVendor('cart_v4@example.bz', 'Shop Four');
    const p = await createProduct(vendor.cookies, { title: 'Repriced', sku: 'RPR', categoryId, priceMinor: 1000 });
    // client cannot dictate price — any priceMinor in the body is ignored
    const added = await addItem(customer, { productId: p, quantity: 1, priceMinor: 1 }).expect(201);
    expect(added.body.vendors[0].items[0].unitPriceMinor).toBe(1000);
    expect(added.body.vendors[0].items[0].priceChanged).toBe(false);

    // vendor raises the price; the cart reflects the new price + a change flag
    await request(ctx.server).patch(`/api/vendor/products/${p}`).set('Cookie', vendor.cookies).send({ priceMinor: 1500 }).expect(200);
    const after = await getCart(customer).expect(200);
    const line = after.body.vendors[0].items[0];
    expect(line.unitPriceMinor).toBe(1500); // current price is source of truth
    expect(line.unitPriceMinorSnapshot).toBe(1000); // what it was when added
    expect(line.priceChanged).toBe(true);
    expect(after.body.hasPriceChanges).toBe(true);
  });
});

describe('unavailable products + inactive storefronts', () => {
  it('rejects adding an archived (unpublished) product and flags one already in the cart', async () => {
    const customer = await registerCustomer('cart_c5@example.bz');
    const vendor = await makeVendor('cart_v5@example.bz', 'Shop Five');
    const p = await createProduct(vendor.cookies, { title: 'Vanishing', sku: 'VAN', categoryId, priceMinor: 1000 });
    await addItem(customer, { productId: p, quantity: 1 }).expect(201);

    // vendor archives it → no longer PUBLISHED
    await request(ctx.server).post(`/api/vendor/products/${p}/archive`).set('Cookie', vendor.cookies).expect(201);
    const blocked = await addItem(customer, { productId: p, quantity: 1 });
    expect(blocked.status).toBe(409);

    const cart = await getCart(customer).expect(200);
    const line = cart.body.vendors[0].items[0];
    expect(line.issues).toContain('PRODUCT_UNAVAILABLE');
    expect(line.purchasable).toBe(false);
    expect(cart.body.hasUnavailableItems).toBe(true);
  });

  it('rejects adding from a storefront that is not approved', async () => {
    const customer = await registerCustomer('cart_c6@example.bz');
    const vendor = await makeVendor('cart_v6@example.bz', 'Shop Six');
    const p = await createProduct(vendor.cookies, { title: 'Suspended Shop Item', sku: 'SSI', categoryId, priceMinor: 1000 });
    await ctx.prisma.vendorProfile.update({ where: { id: vendor.vpId }, data: { approvalStatus: 'SUSPENDED' } });
    const res = await addItem(customer, { productId: p, quantity: 1 });
    expect(res.status).toBe(409);
  });
});

describe('multi-vendor grouping', () => {
  it('groups items by vendor with per-vendor subtotals', async () => {
    const customer = await registerCustomer('cart_c7@example.bz');
    const vA = await makeVendor('cart_v7a@example.bz', 'Alpha Store');
    const vB = await makeVendor('cart_v7b@example.bz', 'Beta Store');
    const pA = await createProduct(vA.cookies, { title: 'A Item', sku: 'AI', categoryId, priceMinor: 1000 });
    const pB = await createProduct(vB.cookies, { title: 'B Item', sku: 'BI', categoryId, priceMinor: 2000 });
    await addItem(customer, { productId: pA, quantity: 2 }).expect(201); // 2000
    const res = await addItem(customer, { productId: pB, quantity: 1 }).expect(201); // 2000
    expect(res.body.vendors).toHaveLength(2);
    const alpha = res.body.vendors.find((v: { businessName: string }) => v.businessName === 'Alpha Store');
    const beta = res.body.vendors.find((v: { businessName: string }) => v.businessName === 'Beta Store');
    expect(alpha.subtotalMinor).toBe(2000);
    expect(beta.subtotalMinor).toBe(2000);
    expect(res.body.subtotalMinor).toBe(4000);
  });
});

describe('ownership isolation + auth + validation', () => {
  let customerA: string[];
  let customerB: string[];
  let itemId: string;

  beforeAll(async () => {
    customerA = await registerCustomer('cart_iso_a@example.bz');
    customerB = await registerCustomer('cart_iso_b@example.bz');
    const vendor = await makeVendor('cart_iso_v@example.bz', 'Iso Store');
    const p = await createProduct(vendor.cookies, { title: 'Iso Item', sku: 'ISO', categoryId, priceMinor: 1000 });
    const res = await addItem(customerA, { productId: p, quantity: 1 }).expect(201);
    itemId = res.body.vendors[0].items[0].id;
  });

  it("keeps each customer's cart private", async () => {
    const bCart = await getCart(customerB).expect(200);
    expect(bCart.body.vendors).toEqual([]);
    expect(bCart.body.id).not.toBe((await getCart(customerA)).body.id);
  });

  it("forbids touching another customer's line (404, not found in own cart)", async () => {
    await request(ctx.server).patch(`/api/cart/items/${itemId}`).set('Cookie', customerB).send({ quantity: 3 }).expect(404);
    await request(ctx.server).delete(`/api/cart/items/${itemId}`).set('Cookie', customerB).expect(404);
    // A's line is untouched
    const aCart = await getCart(customerA).expect(200);
    expect(aCart.body.vendors[0].items[0].quantity).toBe(1);
  });

  it('requires authentication', async () => {
    await request(ctx.server).get('/api/cart').expect(401);
    await request(ctx.server).post('/api/cart/items').send({ productId: 'x', quantity: 1 }).expect(401);
  });

  it('rejects invalid input (zero/negative quantity, missing productId)', async () => {
    await addItem(customerA, { productId: 'clabcabcabcabcabcabcabca', quantity: 0 }).expect(400);
    await addItem(customerA, { quantity: 1 }).expect(400);
  });
});
