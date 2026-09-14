/**
 * Order-line image snapshot — integration against real Postgres + MinIO.
 *
 * An order line shows the image of the exact variant bought, else the
 * product's OWN (non-brand) image, never the storefront brand image; and the
 * choice is frozen at checkout ("imageStorageKey" on the order item) so a
 * later vendor edit cannot rewrite history. Rows with a null snapshot
 * (pre-snapshot orders) fall back to the same live resolution on read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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
  const vpId = profile.body.profile.id as string;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  return { cookies, vpId };
}

/** Raw-body upload; returns the created image's { id, storageKey } read back from the DB. */
async function uploadImage(cookies: string[], productId: string, variantId?: string) {
  const before = await ctx.prisma.productImage.findMany({ where: { productId }, select: { id: true } });
  const res = await request(ctx.server)
    .post(`/api/vendor/products/${productId}/images/upload${variantId ? `?variantId=${variantId}` : ''}`)
    .set('Cookie', cookies)
    .set('Content-Type', 'image/png')
    .send(PNG);
  expect(res.status).toBe(201);
  const created = await ctx.prisma.productImage.findFirstOrThrow({
    where: { productId, id: { notIn: before.map((i) => i.id) } },
  });
  return { id: created.id, storageKey: created.storageKey };
}

const markBrand = (cookies: string[], productId: string, imageId: string) =>
  request(ctx.server).post(`/api/vendor/products/${productId}/images/${imageId}/brand`).set('Cookie', cookies).expect(201);

const addToCart = (cookies: string[], body: Record<string, unknown>) =>
  request(ctx.server).post('/api/cart/items').set('Cookie', cookies).send(body).expect(201);
const checkout = (cookies: string[]) => request(ctx.server).post('/api/checkout').set('Cookie', cookies).send({}).expect(201);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Toiletries' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('order-line image snapshot', () => {
  let vendor: Awaited<ReturnType<typeof makeVendor>>;
  let productId: string;
  let variantId: string;
  let brandKey: string;
  let variantKey: string;
  let customer: string[];
  let orderId: string;
  let vendorOrderId: string;

  it('a variant purchase snapshots the VARIANT image, not the brand image', async () => {
    vendor = await makeVendor('oli_v1@example.bz', 'Bath Goods');
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Bath Bomb', sku: 'BB', categoryId, priceMinor: 1500 });
    productId = p.body.id;

    // One variant with stock, one image assigned to it, plus a brand image.
    await request(ctx.server).post(`/api/vendor/products/${productId}/options`).set('Cookie', vendor.cookies).send({ name: 'Scent', values: ['Vanilla'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${productId}/variants`).set('Cookie', vendor.cookies);
    const valueId = view.body.options[0].values[0].id;
    const created = await request(ctx.server)
      .post(`/api/vendor/products/${productId}/variants`)
      .set('Cookie', vendor.cookies)
      .send({ optionValueIds: [valueId], sku: 'BB-VAN', quantity: 5 });
    variantId = created.body.variants[0].id;

    const brand = await uploadImage(vendor.cookies, productId);
    await markBrand(vendor.cookies, productId, brand.id);
    brandKey = brand.storageKey;
    const vImg = await uploadImage(vendor.cookies, productId, variantId);
    variantKey = vImg.storageKey;

    customer = await registerCustomer('oli_c1@example.bz');
    await addToCart(customer, { productId, variantId, quantity: 1 });
    const res = await checkout(customer);
    orderId = res.body.id;
    vendorOrderId = res.body.vendorOrders[0].id;

    // The snapshot on the row is the variant image's key…
    const item = await ctx.prisma.orderItem.findFirstOrThrow({ where: { vendorOrderId } });
    expect(item.imageStorageKey).toBe(variantKey);
    expect(item.imageStorageKey).not.toBe(brandKey);

    // …and the customer payload serves it, never the brand image.
    const detail = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    const line = detail.body.vendorOrders[0].items[0];
    expect(line.imageUrl).toContain(variantKey);
    expect(line.imageUrl).not.toContain(brandKey);
  });

  it('the vendor order view serves the same snapshot', async () => {
    const res = await request(ctx.server).get(`/api/vendor/orders/${vendorOrderId}`).set('Cookie', vendor.cookies).expect(200);
    expect(res.body.items[0].imageUrl).toContain(variantKey);
    expect(res.body.items[0].imageUrl).not.toContain(brandKey);
  });

  it('deleting the variant image after purchase does not rewrite the order', async () => {
    const img = await ctx.prisma.productImage.findFirstOrThrow({ where: { productId, variantId } });
    await request(ctx.server).delete(`/api/vendor/products/${productId}/images/${img.id}`).set('Cookie', vendor.cookies).expect(200);

    const detail = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(detail.body.vendorOrders[0].items[0].imageUrl).toContain(variantKey);
  });

  it('a legacy row with a null snapshot falls back to the live variant → non-brand resolution', async () => {
    // Pre-snapshot rows cannot be produced through the product path (checkout
    // now always snapshots), so simulate one by clearing the column directly.
    await ctx.prisma.orderItem.updateMany({ where: { vendorOrderId }, data: { imageStorageKey: null } });

    // The variant image was deleted above; the live fallback goes variant →
    // product non-brand. Only the brand image remains, so the line shows NO
    // image rather than the storefront logo.
    const gone = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(gone.body.vendorOrders[0].items[0].imageUrl).toBeNull();

    // Re-add a variant image: the same legacy row now resolves to it live.
    const reAdded = await uploadImage(vendor.cookies, productId, variantId);
    const detail = await request(ctx.server).get(`/api/orders/${orderId}`).set('Cookie', customer).expect(200);
    expect(detail.body.vendorOrders[0].items[0].imageUrl).toContain(reAdded.storageKey);
  });

  it('a product with ONLY a brand image yields a null line image — never the logo', async () => {
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Logo Only Soap', sku: 'LOS', categoryId, priceMinor: 900 });
    const soapId = p.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${soapId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 3, reason: 'RESTOCK' }).expect(201);
    const brand = await uploadImage(vendor.cookies, soapId);
    await markBrand(vendor.cookies, soapId, brand.id);

    const buyer = await registerCustomer('oli_c2@example.bz');
    await addToCart(buyer, { productId: soapId, quantity: 1 });
    const res = await checkout(buyer);

    const voId = res.body.vendorOrders[0].id as string;
    const item = await ctx.prisma.orderItem.findFirstOrThrow({ where: { vendorOrderId: voId } });
    expect(item.imageStorageKey).toBeNull();

    const detail = await request(ctx.server).get(`/api/orders/${res.body.id}`).set('Cookie', buyer).expect(200);
    expect(detail.body.vendorOrders[0].items[0].imageUrl).toBeNull();

    // Boundary guard: the marketplace CARD still shows the brand image —
    // listing behaviour is unchanged by the order-line rule.
    const list = await request(ctx.server).get('/api/marketplace/products').query({ search: 'Logo Only Soap' }).expect(200);
    const card = list.body.items.find((i: { id: string }) => i.id === soapId);
    expect(card.primaryImageUrl).toContain(brand.storageKey);
  });

  it('a simple product (no variants) snapshots its own primary image', async () => {
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Plain Towel', sku: 'PT', categoryId, priceMinor: 2000 });
    const towelId = p.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${towelId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 3, reason: 'RESTOCK' }).expect(201);
    const gallery = await uploadImage(vendor.cookies, towelId);

    const buyer = await registerCustomer('oli_c3@example.bz');
    await addToCart(buyer, { productId: towelId, quantity: 1 });
    const res = await checkout(buyer);

    const voId = res.body.vendorOrders[0].id as string;
    const item = await ctx.prisma.orderItem.findFirstOrThrow({ where: { vendorOrderId: voId } });
    expect(item.imageStorageKey).toBe(gallery.storageKey);
  });
});
