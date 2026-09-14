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

/**
 * Gap coverage added in review (bmpl-qa). Two seams the tests above cannot
 * catch:
 *
 * 1. Serialization now pairs each line with its image BY POSITION
 *    (`lineImageUrls[idx]`) instead of a productId-keyed map. Every test above
 *    buys a single item, so a misalignment that swaps images BETWEEN lines
 *    would pass the whole file. A three-line order pins the pairing.
 * 2. "A vendor edit after checkout must not change the order" is only tested
 *    above by DELETING the image. The other edit — adding a new image and
 *    promoting it to primary — changes what checkout would choose TODAY
 *    without touching the old row, and the order must keep the old choice.
 *    The proof needs both halves: the old order still shows the original,
 *    AND a fresh purchase snapshots the new primary (otherwise the first
 *    assertion could pass because the edit displaced nothing).
 */
describe('order-line image snapshot — line alignment and post-checkout edits', () => {
  it('a three-line order keeps every image on its own line', async () => {
    const vendor = await makeVendor('oli_v2@example.bz', 'Alignment Goods');

    // Line A: variant product with a brand image AND a variant image.
    const pa = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Scented Candle', sku: 'SC', categoryId, priceMinor: 1200 });
    const candleId = pa.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${candleId}/options`).set('Cookie', vendor.cookies).send({ name: 'Scent', values: ['Citrus'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${candleId}/variants`).set('Cookie', vendor.cookies);
    const valueId = view.body.options[0].values[0].id;
    const created = await request(ctx.server)
      .post(`/api/vendor/products/${candleId}/variants`)
      .set('Cookie', vendor.cookies)
      .send({ optionValueIds: [valueId], sku: 'SC-CIT', quantity: 5 });
    const candleVariantId = created.body.variants[0].id as string;
    const candleBrand = await uploadImage(vendor.cookies, candleId);
    await markBrand(vendor.cookies, candleId, candleBrand.id);
    const candleVariantImg = await uploadImage(vendor.cookies, candleId, candleVariantId);

    // Line B: simple product with a gallery image of its own.
    const pb = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Wash Cloth', sku: 'WC', categoryId, priceMinor: 500 });
    const clothId = pb.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${clothId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 3, reason: 'RESTOCK' }).expect(201);
    const clothImg = await uploadImage(vendor.cookies, clothId);

    // Line C: brand-image-only product — its line must be image-less.
    const pc = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Logo Sponge', sku: 'LS', categoryId, priceMinor: 300 });
    const spongeId = pc.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${spongeId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 3, reason: 'RESTOCK' }).expect(201);
    const spongeBrand = await uploadImage(vendor.cookies, spongeId);
    await markBrand(vendor.cookies, spongeId, spongeBrand.id);

    const buyer = await registerCustomer('oli_c4@example.bz');
    await addToCart(buyer, { productId: candleId, variantId: candleVariantId, quantity: 1 });
    await addToCart(buyer, { productId: clothId, quantity: 1 });
    await addToCart(buyer, { productId: spongeId, quantity: 1 });
    const res = await checkout(buyer);

    const detail = await request(ctx.server).get(`/api/orders/${res.body.id}`).set('Cookie', buyer).expect(200);
    const items = detail.body.vendorOrders[0].items as { productTitle: string; imageUrl: string | null }[];
    expect(items).toHaveLength(3);
    const byTitle = (t: string) => {
      const item = items.find((i) => i.productTitle === t);
      expect(item, t).toBeDefined();
      return item!;
    };
    // Each line wears ITS OWN image — a positional swap fails one of these.
    expect(byTitle('Scented Candle').imageUrl).toContain(candleVariantImg.storageKey);
    expect(byTitle('Scented Candle').imageUrl).not.toContain(candleBrand.storageKey);
    expect(byTitle('Wash Cloth').imageUrl).toContain(clothImg.storageKey);
    expect(byTitle('Logo Sponge').imageUrl).toBeNull();

    // And the snapshots on the rows agree with what was served.
    const voId = detail.body.vendorOrders[0].id as string;
    const rows = await ctx.prisma.orderItem.findMany({ where: { vendorOrderId: voId } });
    expect(rows.find((r) => r.productTitle === 'Scented Candle')?.imageStorageKey).toBe(candleVariantImg.storageKey);
    expect(rows.find((r) => r.productTitle === 'Wash Cloth')?.imageStorageKey).toBe(clothImg.storageKey);
    expect(rows.find((r) => r.productTitle === 'Logo Sponge')?.imageStorageKey).toBeNull();
  });

  it('promoting a NEW primary image after checkout changes new orders, never old ones', async () => {
    const vendor = await makeVendor('oli_v3@example.bz', 'Edit Goods');
    const p = await request(ctx.server)
      .post('/api/vendor/products')
      .set('Cookie', vendor.cookies)
      .send({ title: 'Loofah', sku: 'LF', categoryId, priceMinor: 800 });
    const loofahId = p.body.id as string;
    await request(ctx.server).post(`/api/vendor/products/${loofahId}/inventory/adjust`).set('Cookie', vendor.cookies).send({ delta: 5, reason: 'RESTOCK' }).expect(201);
    const original = await uploadImage(vendor.cookies, loofahId);

    const firstBuyer = await registerCustomer('oli_c5@example.bz');
    await addToCart(firstBuyer, { productId: loofahId, quantity: 1 });
    const firstOrder = await checkout(firstBuyer);

    // The vendor's edit: a second image, promoted to the product's primary.
    const replacement = await uploadImage(vendor.cookies, loofahId);
    await request(ctx.server)
      .post(`/api/vendor/products/${loofahId}/images/${replacement.id}/primary`)
      .set('Cookie', vendor.cookies)
      .expect(201);

    // Control half: a purchase made AFTER the edit snapshots the NEW primary —
    // proof the edit really did displace the live choice…
    const secondBuyer = await registerCustomer('oli_c6@example.bz');
    await addToCart(secondBuyer, { productId: loofahId, quantity: 1 });
    const secondOrder = await checkout(secondBuyer);
    const secondDetail = await request(ctx.server).get(`/api/orders/${secondOrder.body.id}`).set('Cookie', secondBuyer).expect(200);
    expect(secondDetail.body.vendorOrders[0].items[0].imageUrl).toContain(replacement.storageKey);

    // …which makes this the real assertion: the OLD order still shows what
    // was bought, untouched by the edit.
    const firstDetail = await request(ctx.server).get(`/api/orders/${firstOrder.body.id}`).set('Cookie', firstBuyer).expect(200);
    expect(firstDetail.body.vendorOrders[0].items[0].imageUrl).toContain(original.storageKey);
    expect(firstDetail.body.vendorOrders[0].items[0].imageUrl).not.toContain(replacement.storageKey);
  });
});
