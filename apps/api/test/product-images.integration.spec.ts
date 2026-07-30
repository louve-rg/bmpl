/**
 * Product images (Phase 2 · M5) — integration against real Postgres + MinIO.
 * Presign + upload + confirm (real MIME/size via headObject), primary invariant,
 * reorder, alt/caption, delete (+ primary promotion), public gallery, ownership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, putToPresigned, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

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

async function makeVendorWithProduct(email: string, business: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await request(ctx.server).post('/api/vendor/profile').set('Cookie', cookies).send({ businessName: business, contactEmail: email });
  const vpId = profile.body.profile.id;
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${vpId}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  const p = await request(ctx.server)
    .post('/api/vendor/products')
    .set('Cookie', cookies)
    .send({ title: `${business} Item`, sku: `${business}-1`, categoryId, priceMinor: 1000 });
  return { cookies, productId: p.body.id, vpId };
}

async function uploadImage(cookies: string[], productId: string) {
  const presign = await request(ctx.server)
    .post(`/api/vendor/products/${productId}/images/presign`)
    .set('Cookie', cookies)
    .send({ fileName: 'photo.png', contentType: 'image/png', sizeBytes: PNG.length });
  expect(presign.status).toBe(201);
  expect(await putToPresigned(presign.body.uploadUrl, PNG, 'image/png')).toBe(200);
  return presign.body.key as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Gear' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('product image manager', () => {
  let vendor: Awaited<ReturnType<typeof makeVendorWithProduct>>;
  let img1: string;
  let img2: string;

  it('rejects an unsupported MIME at presign', async () => {
    vendor = await makeVendorWithProduct('img_v@example.bz', 'Imgs');
    const res = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/presign`)
      .set('Cookie', vendor.cookies)
      .send({ fileName: 'x.gif', contentType: 'image/gif', sizeBytes: 100 });
    expect(res.status).toBe(400);
  });

  it('uploads + confirms the first image (auto-primary, real MIME/size)', async () => {
    const key = await uploadImage(vendor.cookies, vendor.productId);
    const res = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/confirm`)
      .set('Cookie', vendor.cookies)
      .send({ key, width: 1, height: 1, altText: 'A tiny dot', caption: 'first' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].isPrimary).toBe(true);
    expect(res.body[0].mimeType).toBe('image/png');
    expect(res.body[0].fileSizeBytes).toBe(PNG.length);
    expect(res.body[0].width).toBe(1);
    expect(res.body[0].altText).toBe('A tiny dot');
    img1 = res.body[0].id;
  });

  it('rejects a forged key from another namespace', async () => {
    const res = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/confirm`)
      .set('Cookie', vendor.cookies)
      .send({ key: 'vendors/someone/products/other/forged.png' });
    expect(res.status).toBe(400);
  });

  it('adds a second image (not primary, position 1)', async () => {
    const key = await uploadImage(vendor.cookies, vendor.productId);
    const res = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/confirm`)
      .set('Cookie', vendor.cookies)
      .send({ key });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    const second = res.body.find((i: { position: number }) => i.position === 1);
    expect(second.isPrimary).toBe(false);
    img2 = second.id;
  });

  it('sets a new primary (exactly one primary remains)', async () => {
    const res = await request(ctx.server).post(`/api/vendor/products/${vendor.productId}/images/${img2}/primary`).set('Cookie', vendor.cookies);
    expect(res.status).toBe(201);
    expect(res.body.filter((i: { isPrimary: boolean }) => i.isPrimary)).toHaveLength(1);
    expect(res.body.find((i: { id: string }) => i.id === img2).isPrimary).toBe(true);
  });

  it('reorders images', async () => {
    const res = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/reorder`)
      .set('Cookie', vendor.cookies)
      .send({ order: [img1, img2] });
    expect(res.status).toBe(201);
    // reorder validation: must include every image exactly once
    const bad = await request(ctx.server)
      .post(`/api/vendor/products/${vendor.productId}/images/reorder`)
      .set('Cookie', vendor.cookies)
      .send({ order: [img1] });
    expect(bad.status).toBe(400);
  });

  it('updates alt text + caption', async () => {
    const res = await request(ctx.server)
      .patch(`/api/vendor/products/${vendor.productId}/images/${img1}`)
      .set('Cookie', vendor.cookies)
      .send({ altText: 'Updated', caption: 'New caption' });
    expect(res.status).toBe(200);
    expect(res.body.find((i: { id: string }) => i.id === img1).altText).toBe('Updated');
  });

  it('deletes the primary and promotes the next image', async () => {
    // img2 is primary; delete it → img1 should become primary
    const res = await request(ctx.server).delete(`/api/vendor/products/${vendor.productId}/images/${img2}`).set('Cookie', vendor.cookies);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(img1);
    expect(res.body[0].isPrimary).toBe(true);
  });

  it('exposes the gallery on the public product detail', async () => {
    // vendor already approved by the helper; products are published on create.
    const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: vendor.productId } });
    const detail = await request(ctx.server).get(`/api/marketplace/products/${prod.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.images).toHaveLength(1);
    expect(detail.body.images[0].isPrimary).toBe(true);
  });
});

describe('image ownership', () => {
  it("forbids vendor B from managing vendor A's product images", async () => {
    const a = await makeVendorWithProduct('img_a@example.bz', 'AImg');
    const b = await makeVendorWithProduct('img_b@example.bz', 'BImg');
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/images`).set('Cookie', b.cookies).expect(404);
    await request(ctx.server)
      .post(`/api/vendor/products/${a.productId}/images/presign`)
      .set('Cookie', b.cookies)
      .send({ fileName: 'x.png', contentType: 'image/png', sizeBytes: 100 })
      .expect(404);
  });

  it('forbids a customer and unauthenticated access', async () => {
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'img_customer@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    const customer = cookiesOf(reg);
    const a = await makeVendorWithProduct('img_a2@example.bz', 'A2Img');
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/images`).set('Cookie', customer).expect(403);
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/images`).expect(401);
  });
});
