/**
 * Public gallery is built only from currently-valid records, and ordering never buries
 * a product with a null publishedAt (client follow-up). Real Postgres.
 * - Deactivating/deleting a variant removes its images + thumbnails from the gallery
 *   (deleted-variant images are removed, not orphaned into the general gallery).
 * - The Brand Image is never in the product gallery.
 * - COALESCE(publishedAt, createdAt) ordering: a null-publishedAt but newer product
 *   still sorts ahead of an older one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const post = (c: string[], p: string, b: unknown = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, pw: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password: pw });
  return cookiesOf(r);
}
async function makeVendor() {
  const email = `v_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const created = await post(cookies, 'vendor/profile', { businessName: `Store ${uniq()}`, contactEmail: email });
  await post(cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${created.body.profile.id}/approve`, {});
  return { cookies };
}
async function seedImage(productId: string, variantId: string | null, isBrandImage = false) {
  return ctx.prisma.productImage.create({
    data: { productId, variantId, isBrandImage, storageKey: `products/${productId}/${uniq()}.jpg`, mimeType: 'image/jpeg', fileSizeBytes: 1000 },
  });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await login(a.email, a.password);
  categoryId = (await post(admin, 'admin/categories', { name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => { await ctx.app.close(); });

describe('gallery is built only from valid records', () => {
  it('drops images of deactivated + deleted variants; keeps general; excludes Brand Image', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Prod ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 2000 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Color', values: ['Red', 'Blue'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const val = (v: string) => view.body.options[0].values.find((x: { value: string }) => x.value === v).id;
    const red = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Red')], sku: 'RED' })).body.variants[0].id;
    const blue = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Blue')], sku: 'BLUE' })).body.variants[0].id;

    const gen = await seedImage(productId, null);
    const redImg = await seedImage(productId, red);
    const blueImg = await seedImage(productId, blue);
    await seedImage(productId, null, true); // brand image

    const galleryIds = async () => ((await guest(`marketplace/products/${slug}`)).body.images as Array<{ id: string }>).map((i) => i.id);

    // all three non-brand images present; brand excluded
    let ids = await galleryIds();
    expect(ids).toEqual(expect.arrayContaining([gen.id, redImg.id, blueImg.id]));
    expect(ids).toHaveLength(3);

    // deactivate Blue → its image disappears
    await request(ctx.server).patch(`/api/vendor/products/${productId}/variants/${blue}`).set('Cookie', vendor.cookies).send({ isActive: false });
    ids = await galleryIds();
    expect(ids).not.toContain(blueImg.id);
    expect(ids).toEqual(expect.arrayContaining([gen.id, redImg.id]));

    // delete Red variant → its image is removed (NOT orphaned into the general gallery)
    expect((await del(vendor.cookies, `vendor/products/${productId}/variants/${red}`)).status).toBe(200);
    ids = await galleryIds();
    expect(ids).not.toContain(redImg.id);
    expect(ids).toEqual([gen.id]); // only the general image remains
    // the deleted variant's image row is gone (not left with variantId=null)
    expect(await ctx.prisma.productImage.findUnique({ where: { id: redImg.id } })).toBeNull();
  });
});

describe('newest variant first', () => {
  it('lineup is newest-created first; deleting the newest makes the next first; a new variant leads', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Prod ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 2000 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Size', values: ['S', 'M', 'L', 'XL'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const val = (v: string) => view.body.options[0].values.find((x: { value: string }) => x.value === v).id;
    const mk = async (size: string) => (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val(size)], sku: size })).body.variants[0].id as string;
    const A = await mk('S');
    const B = await mk('M');
    const C = await mk('L');
    // deterministic createdAt: A oldest → C newest
    await ctx.prisma.productVariant.update({ where: { id: A }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    await ctx.prisma.productVariant.update({ where: { id: B }, data: { createdAt: new Date('2026-02-01T00:00:00Z') } });
    await ctx.prisma.productVariant.update({ where: { id: C }, data: { createdAt: new Date('2026-03-01T00:00:00Z') } });

    const lineup = async () => ((await guest(`marketplace/products/${slug}`)).body.variants as Array<{ id: string }>).map((v) => v.id);
    expect(await lineup()).toEqual([C, B, A]); // newest first

    // delete the newest (C) → B leads
    expect((await del(vendor.cookies, `vendor/products/${productId}/variants/${C}`)).status).toBe(200);
    expect(await lineup()).toEqual([B, A]);

    // add a new variant (D) → it leads
    const D = await mk('XL');
    await ctx.prisma.productVariant.update({ where: { id: D }, data: { createdAt: new Date('2026-04-01T00:00:00Z') } });
    expect(await lineup()).toEqual([D, B, A]);
  });
});

describe('ordering never buries a null-publishedAt product', () => {
  it('COALESCE(publishedAt, createdAt): a newer product with null publishedAt still leads', async () => {
    const vendor = await makeVendor();
    const older = (await post(vendor.cookies, 'vendor/products', { title: `Old ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 100 })).body.id;
    const newer = (await post(vendor.cookies, 'vendor/products', { title: `New ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 100 })).body.id;
    // older: publishedAt set in the past. newer: NULL publishedAt but a recent createdAt (legacy-style row).
    await ctx.prisma.product.update({ where: { id: older }, data: { publishedAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z') } });
    await ctx.prisma.product.update({ where: { id: newer }, data: { publishedAt: null, createdAt: new Date('2026-06-01T00:00:00Z') } });
    const order = (await guest('marketplace/products?sort=newest')).body.items.map((x: { id: string }) => x.id).filter((x: string) => [older, newer].includes(x));
    expect(order).toEqual([newer, older]); // newer (null publishedAt, recent createdAt) is NOT buried
  });
});
