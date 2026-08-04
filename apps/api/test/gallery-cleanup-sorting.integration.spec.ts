/**
 * Public gallery is built only from currently-valid, PUBLICLY-ELIGIBLE records, and
 * ordering never buries a product with a null publishedAt (client follow-up). Real Postgres.
 * - For a VARIANT product the public gallery is ONLY images of ACTIVE variants;
 *   General (variantId = null) images are an internal editor pool and are NEVER public.
 * - Deactivating/deleting a variant removes its images + thumbnails from the gallery
 *   (deleted-variant images are removed, not orphaned into the general gallery).
 * - The Brand Image is never in the product gallery.
 * - A SIMPLE product (no variants) DOES show its general (null-variant) images.
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

describe('gallery is built only from valid, publicly-eligible records', () => {
  it('variant product: shows only ACTIVE-variant images; General is never public; Brand excluded', async () => {
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

    // ONLY the two active-variant images — the General (unassigned) image and the Brand image are excluded.
    let ids = await galleryIds();
    expect(ids).toEqual(expect.arrayContaining([redImg.id, blueImg.id]));
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(gen.id); // General is never public for a variant product

    // deactivate Blue → its image disappears (General still excluded)
    await request(ctx.server).patch(`/api/vendor/products/${productId}/variants/${blue}`).set('Cookie', vendor.cookies).send({ isActive: false });
    ids = await galleryIds();
    expect(ids).toEqual([redImg.id]);
    expect(ids).not.toContain(gen.id);

    // delete Red variant → its image is removed; nothing falls back to the General pool
    expect((await del(vendor.cookies, `vendor/products/${productId}/variants/${red}`)).status).toBe(200);
    ids = await galleryIds();
    expect(ids).toEqual([]); // no public images — the General image is NOT borrowed
    // the deleted variant's image row is gone (not orphaned into General)
    expect(await ctx.prisma.productImage.findUnique({ where: { id: redImg.id } })).toBeNull();
    // the General image row is PRESERVED (still in the editor pool), just never public
    expect(await ctx.prisma.productImage.findUnique({ where: { id: gen.id } })).not.toBeNull();
    // ...and it is still visible in the vendor editor (list = all images)
    const editor = (await get(vendor.cookies, `vendor/products/${productId}/images`)).body as Array<{ id: string; role: string }>;
    expect(editor.some((i) => i.id === gen.id && i.role === 'GENERAL')).toBe(true);
  });

  it('simple product (no variants): its General (null-variant) images ARE the public gallery', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Simple ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 1500 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    const a = await seedImage(productId, null);
    const b = await seedImage(productId, null);
    await seedImage(productId, null, true); // brand image (still excluded)
    const ids = ((await guest(`marketplace/products/${slug}`)).body.images as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids).toHaveLength(2); // general images public; brand excluded
  });
});

describe('General (not assigned) fixture — Bath & Body (A,B general; C on Hello Beautiful)', () => {
  it('A,B stay editor-only; C is public only for its variant; reassign/move-back flip visibility', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Bath & Body ${uniq()}`, sku: `BB-${uniq()}`, categoryId, priceMinor: 2000 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Fragrance', values: ['Gingham', 'Twisted Peppermint', 'Hello Beautiful'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const val = (v: string) => view.body.options[0].values.find((x: { value: string }) => x.value === v).id;
    const gingham = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Gingham')], sku: 'GING' })).body.variants[0].id;
    (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Twisted Peppermint')], sku: 'TP' }));
    const hello = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Hello Beautiful')], sku: 'HB' })).body.variants[0].id;

    const A = await seedImage(productId, null);
    const B = await seedImage(productId, null);
    const C = await seedImage(productId, hello);

    const publicIds = async () => ((await guest(`marketplace/products/${slug}`)).body.images as Array<{ id: string }>).map((i) => i.id);

    // Public: only C (Hello Beautiful). A & B (General) are not public. Gingham/Twisted = no image.
    expect(await publicIds()).toEqual([C.id]);

    // Editor still shows A & B in the General pool.
    const editorIds = ((await get(vendor.cookies, `vendor/products/${productId}/images`)).body as Array<{ id: string }>).map((i) => i.id);
    expect(editorIds).toEqual(expect.arrayContaining([A.id, B.id, C.id]));

    // Assign A → Gingham: it becomes public for Gingham only.
    await request(ctx.server).patch(`/api/vendor/products/${productId}/images/${A.id}`).set('Cookie', vendor.cookies).send({ variantId: gingham }).expect(200);
    expect((await publicIds()).sort()).toEqual([A.id, C.id].sort());

    // Move A back to General (not assigned): it disappears publicly but stays in the editor.
    await request(ctx.server).patch(`/api/vendor/products/${productId}/images/${A.id}`).set('Cookie', vendor.cookies).send({ variantId: null }).expect(200);
    expect(await publicIds()).toEqual([C.id]);
    expect(await ctx.prisma.productImage.findUnique({ where: { id: A.id } })).not.toBeNull();

    // Delete B: gone from the editor, never was public.
    await del(vendor.cookies, `vendor/products/${productId}/images/${B.id}`).expect(200);
    expect(await ctx.prisma.productImage.findUnique({ where: { id: B.id } })).toBeNull();
    expect(await publicIds()).toEqual([C.id]);
  });

  it('Brand Image stays listing-only and separate from the General pool', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Brandy ${uniq()}`, sku: `BR-${uniq()}`, categoryId, priceMinor: 2000 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Size', values: ['S', 'M'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const small = view.body.options[0].values.find((x: { value: string }) => x.value === 'S').id;
    const s = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [small], sku: 'S1' })).body.variants[0].id;
    const variantImg = await seedImage(productId, s);
    const general = await seedImage(productId, null);

    // Make the General image the Brand image → it detaches to listing-only.
    await post(vendor.cookies, `vendor/products/${productId}/images/${general.id}/brand`).expect(201);
    const detail = (await guest(`marketplace/products/${slug}`)).body;
    const galleryIds = (detail.images as Array<{ id: string }>).map((i) => i.id);
    expect(galleryIds).toEqual([variantImg.id]); // brand excluded from gallery
    expect(detail.brandImageUrl).toBeTruthy(); // brand exposed via its own field
    // Brand image is not variant-scoped and not in the gallery — distinct from General.
    const brandRow = await ctx.prisma.productImage.findUnique({ where: { id: general.id } });
    expect(brandRow?.isBrandImage).toBe(true);
    expect(brandRow?.variantId).toBeNull();
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
