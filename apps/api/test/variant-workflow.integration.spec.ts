/**
 * Vendor variant & image workflow redesign (M6.1) — integration vs real Postgres +
 * MinIO. Editable options after save, safe variant generation (only missing combos),
 * rename value, variant-specific display names + title precedence, multiple images
 * per variant, per-variant primary, in-place file replace, image reassignment, and
 * the "Perfect in Pink" regression: the variant title survives publication →
 * cart → checkout → order and never reverts to the base product name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, putToPresigned, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: unknown = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: unknown = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

interface Vendor { cookies: string[]; productId: string; vendorProfileId: string; slug: string }
async function makeVendorWithProduct(title: string): Promise<Vendor> {
  const s = uniq();
  const email = `vend_${s}@example.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await post(cookies, 'vendor/profile', { businessName: `Store ${s}`, contactEmail: email });
  await post(cookies, 'vendor/profile/submit').expect(201);
  await post(adminCookies, `admin/vendors/${profile.body.profile.id}/approve`).expect(201);
  const p = await post(cookies, 'vendor/products', { title, sku: `SKU-${s}`, categoryId, priceMinor: 1000 });
  const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: p.body.id } });
  return { cookies, productId: p.body.id, vendorProfileId: profile.body.profile.id, slug: prod.slug };
}

/** Add an option with values; return { optionId, valueIds{byValue} }. */
async function addOption(v: Vendor, name: string, values: string[]) {
  await post(v.cookies, `vendor/products/${v.productId}/options`, { name, values }).expect(201);
  const view = await get(v.cookies, `vendor/products/${v.productId}/variants`);
  const opt = view.body.options.find((o: { name: string }) => o.name === name);
  const byValue: Record<string, string> = {};
  for (const x of opt.values) byValue[x.value] = x.id;
  return { optionId: opt.id, byValue, view };
}

async function uploadImageToVariant(v: Vendor, variantId: string | null) {
  const presign = await post(v.cookies, `vendor/products/${v.productId}/images/presign`, { fileName: 'x.jpg', contentType: 'image/jpeg', sizeBytes: 4 });
  expect(presign.status).toBe(201);
  expect(await putToPresigned(presign.body.uploadUrl, JPEG, 'image/jpeg')).toBe(200);
  const confirm = await post(v.cookies, `vendor/products/${v.productId}/images/confirm`, { key: presign.body.key, ...(variantId ? { variantId } : {}) });
  expect(confirm.status).toBe(201);
  return confirm.body as Array<{ id: string; variantId: string | null; isPrimary: boolean; position: number; url: string; isBrandImage?: boolean; role?: string }>;
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

describe('editable options + safe variant generation', () => {
  it('adds a new option value AFTER variants exist, preserving existing variants', async () => {
    const v = await makeVendorWithProduct('Body Lotion & Spray');
    const frag = await addOption(v, 'Fragrance', ['Hello Beautiful', 'Perfect in Pink']);
    // create the two variants
    const c1 = await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [frag.byValue['Hello Beautiful']], sku: 'HB', quantity: 3 });
    expect(c1.status).toBe(201);
    await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [frag.byValue['Perfect in Pink']], sku: 'PIP', quantity: 4 }).expect(201);
    const before = await get(v.cookies, `vendor/products/${v.productId}/variants`);
    expect(before.body.variants).toHaveLength(2);
    const hbId = before.body.variants.find((x: { sku: string }) => x.sku === 'HB').id;

    // Add "Gingham" as a NEW value while variants already exist (this used to be impossible)
    const addVal = await post(v.cookies, `vendor/products/${v.productId}/options/${frag.optionId}/values`, { value: 'Gingham' });
    expect(addVal.status).toBe(201);
    const ginghamId = addVal.body.options[0].values.find((x: { value: string }) => x.value === 'Gingham').id;
    // existing variants untouched
    const after = await get(v.cookies, `vendor/products/${v.productId}/variants`);
    expect(after.body.variants).toHaveLength(2);
    expect(after.body.variants.find((x: { id: string }) => x.id === hbId)).toBeTruthy();
    expect(after.body.variants.find((x: { sku: string }) => x.sku === 'HB').quantity).toBe(3);

    // create the Gingham variant without deleting anything
    const gv = await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [ginghamId], sku: 'GING', quantity: 2 });
    expect(gv.status).toBe(201);
    expect(gv.body.variants).toHaveLength(3);
  });

  it('generate creates only missing combinations and preserves existing data', async () => {
    const v = await makeVendorWithProduct('Tee');
    const color = await addOption(v, 'Color', ['Red', 'Blue']);
    await addOption(v, 'Size', ['S', 'M']);
    const size = (await get(v.cookies, `vendor/products/${v.productId}/variants`)).body.options.find((o: { name: string }) => o.name === 'Size');
    const sizeS = size.values.find((x: { value: string }) => x.value === 'S').id;
    // pre-create Red/S with a specific SKU + qty
    await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Red'], sizeS], sku: 'RED-S', quantity: 9 }).expect(201);
    // generate the rest (2×2=4 combos → 3 created)
    const gen = await post(v.cookies, `vendor/products/${v.productId}/variants/generate`, {});
    expect(gen.status).toBe(201);
    expect(gen.body.created).toBe(3);
    expect(gen.body.variants).toHaveLength(4);
    // the pre-existing Red/S is preserved (sku + qty intact)
    const redS = gen.body.variants.find((x: { sku: string }) => x.sku === 'RED-S');
    expect(redS.quantity).toBe(9);
    // a second generate is a no-op
    const gen2 = await post(v.cookies, `vendor/products/${v.productId}/variants/generate`, {});
    expect(gen2.body.created).toBe(0);
    expect(gen2.body.variants).toHaveLength(4);
  });

  it('rejects a duplicate combination with a helpful message; renames a value', async () => {
    const v = await makeVendorWithProduct('Mug');
    const color = await addOption(v, 'Color', ['Red']);
    await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Red']] }).expect(201);
    const dup = await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Red']] });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already exists/i);
    // rename Red → Crimson (variant preserved, no recreation)
    const ren = await patch(v.cookies, `vendor/products/${v.productId}/option-values/${color.byValue['Red']}`, { value: 'Crimson' });
    expect(ren.status).toBe(200);
    expect(ren.body.options[0].values[0].value).toBe('Crimson');
    expect(ren.body.variants).toHaveLength(1); // same variant, just relabeled
  });
});

describe('variant display name + title precedence (Perfect in Pink regression)', () => {
  it('variant title stays variant-specific through publication, cart, checkout, and order', async () => {
    const v = await makeVendorWithProduct('Bath & Body Works Body Lotion & Spray');
    const frag = await addOption(v, 'Fragrance', ['Hello Beautiful', 'Perfect in Pink']);
    // No explicit displayName → the option label IS the title
    await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [frag.byValue['Hello Beautiful']], sku: 'HB', quantity: 5 }).expect(201);
    const pip = await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [frag.byValue['Perfect in Pink']], sku: 'PIP', quantity: 5 });
    const pipId = pip.body.variants.find((x: { sku: string }) => x.sku === 'PIP').id;

    // Public detail: variant title = "Perfect in Pink", NOT the base product name
    const detail = await get([], `marketplace/products/${v.slug}`);
    const pipVariant = detail.body.variants.find((x: { sku: string }) => x.sku === 'PIP');
    expect(pipVariant.title).toBe('Perfect in Pink');
    expect(pipVariant.title).not.toBe('Bath & Body Works Body Lotion & Spray');
    expect(detail.body.variants.find((x: { sku: string }) => x.sku === 'HB').title).toBe('Hello Beautiful');

    // An explicit displayName takes precedence and survives image/price/inventory edits
    await patch(v.cookies, `vendor/products/${v.productId}/variants/${pipId}`, { displayName: 'Perfect in Pink ✨' }).expect(200);
    await post(v.cookies, `vendor/products/${v.productId}/inventory/adjust?variantId=${pipId}`, { delta: 3, reason: 'RESTOCK' }).expect(201);
    const detail2 = await get([], `marketplace/products/${v.slug}`);
    expect(detail2.body.variants.find((x: { sku: string }) => x.sku === 'PIP').title).toBe('Perfect in Pink ✨');

    // Cart: variantTitle is variant-specific (not the base product title)
    const custReg = await request(ctx.server).post('/api/auth/register').send({ email: `pip_cust_${uniq()}@example.bz`, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    const cust = cookiesOf(custReg);
    await post(cust, 'cart/items', { productId: v.productId, variantId: pipId, quantity: 1 }).expect(201);
    const cart = await get(cust, 'cart');
    const line = cart.body.vendors.flatMap((g: { items: unknown[] }) => g.items).find((i: { variantId: string }) => i.variantId === pipId);
    expect(line.variantTitle).toBe('Perfect in Pink ✨');
    expect(line.title).toBe('Bath & Body Works Body Lotion & Spray'); // base title kept separately

    // Checkout → order snapshot preserves the variant display name
    const checkout = await post(cust, 'checkout', { vendors: [{ vendorProfileId: v.vendorProfileId, deliveryMethod: 'PICKUP' }] });
    expect(checkout.status).toBe(201);
    const order = await get(cust, `orders/${checkout.body.id}`);
    const item = order.body.vendorOrders.flatMap((vo: { items: unknown[] }) => vo.items).find((i: { sku: string }) => i.sku === 'PIP');
    expect(item.variantTitle).toBe('Perfect in Pink ✨');
    expect(item.productTitle).toBe('Bath & Body Works Body Lotion & Spray');
  });
});

describe('per-variant image galleries', () => {
  it('supports multiple images per variant, per-variant primary, replace-in-place, and reassignment', async () => {
    const v = await makeVendorWithProduct('Sneaker');
    const color = await addOption(v, 'Color', ['Red', 'Blue']);
    const redV = (await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Red']], sku: 'R' })).body.variants[0].id;
    const blueVres = await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Blue']], sku: 'B' });
    const blueV = blueVres.body.variants.find((x: { sku: string }) => x.sku === 'B').id;

    // multiple images for the Red variant
    await uploadImageToVariant(v, redV);
    let imgs = await uploadImageToVariant(v, redV);
    const redImages = imgs.filter((i) => i.variantId === redV);
    expect(redImages.length).toBe(2);
    // one Blue image
    imgs = await uploadImageToVariant(v, blueV);
    const blueImg = imgs.find((i) => i.variantId === blueV)!;

    // set the SECOND red image as primary → primary is per-variant-group
    const secondRed = imgs.filter((i) => i.variantId === redV).sort((a, b) => a.position - b.position)[1]!;
    const afterPrimary = (await post(v.cookies, `vendor/products/${v.productId}/images/${secondRed.id}/primary`)).body as typeof imgs;
    const redPrimaries = afterPrimary.filter((i) => i.variantId === redV && i.isPrimary);
    expect(redPrimaries).toHaveLength(1);
    expect(redPrimaries[0].id).toBe(secondRed.id);
    // Blue's own primary is unaffected (still its single image)
    expect(afterPrimary.find((i) => i.id === blueImg.id)!.isPrimary).toBe(true);

    // REPLACE the file of the red primary in place — variant + primary + position preserved
    const presign = await post(v.cookies, `vendor/products/${v.productId}/images/presign`, { fileName: 'new.jpg', contentType: 'image/jpeg', sizeBytes: 4 });
    await putToPresigned(presign.body.uploadUrl, JPEG, 'image/jpeg');
    const replaced = (await post(v.cookies, `vendor/products/${v.productId}/images/${secondRed.id}/replace`, { key: presign.body.key })).body as typeof imgs;
    const stillPrimary = replaced.find((i) => i.id === secondRed.id)!;
    expect(stillPrimary.variantId).toBe(redV); // variant preserved
    expect(stillPrimary.isPrimary).toBe(true); // primary preserved

    // reassign the blue image to the red variant
    const reassigned = (await patch(v.cookies, `vendor/products/${v.productId}/images/${blueImg.id}`, { variantId: redV })).body as typeof imgs;
    expect(reassigned.find((i) => i.id === blueImg.id)!.variantId).toBe(redV);

    // public detail exposes per-image variantId so the storefront can switch galleries
    const detail = await get([], `marketplace/products/${v.slug}`);
    expect(detail.body.images.some((i: { variantId: string | null }) => i.variantId === redV)).toBe(true);
  });
});

describe('brand image role (M6.2)', () => {
  it('brand image is a distinct listing role: excluded from the detail gallery, used for the card, one-per-product', async () => {
    const v = await makeVendorWithProduct('Bath & Body');
    // two general gallery images + one brand image
    await uploadImageToVariant(v, null);
    let imgs = await uploadImageToVariant(v, null);
    const brandCandidate = imgs[0]!;
    // set the first as the brand image
    const afterBrand = (await post(v.cookies, `vendor/products/${v.productId}/images/${brandCandidate.id}/brand`)).body as typeof imgs;
    const brand = afterBrand.find((i) => i.id === brandCandidate.id)!;
    expect(brand.isBrandImage).toBe(true);
    expect(brand.role).toBe('BRAND');
    expect(brand.variantId).toBeNull(); // brand image is never variant-scoped
    expect(afterBrand.filter((i) => i.isBrandImage)).toHaveLength(1); // exactly one

    // public detail gallery EXCLUDES the brand image; brandImageUrl is exposed
    const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: v.productId } });
    const detail = await get([], `marketplace/products/${prod.slug}`);
    expect(detail.body.brandImageUrl).toBeTruthy();
    expect(detail.body.images.some((i: { id: string }) => i.id === brandCandidate.id)).toBe(false);
    // the marketplace card uses the brand image (precedence #1)
    const list = await get([], `marketplace/products?pageSize=48`);
    const card = list.body.items.find((p: { id: string }) => p.id === v.productId);
    expect(card).toBeTruthy();
    expect(card.primaryImageUrl).toBe(brand.url);

    // setting another image as brand replaces the designation (no delete)
    const other = imgs[1]!;
    const replaced = (await post(v.cookies, `vendor/products/${v.productId}/images/${other.id}/brand`)).body as typeof imgs;
    expect(replaced.find((i) => i.id === other.id)!.isBrandImage).toBe(true);
    expect(replaced.find((i) => i.id === brandCandidate.id)!.isBrandImage).toBe(false);
    expect(replaced).toHaveLength(2); // both files still exist

    // clearing the designation returns it to the gallery
    const cleared = (await request(ctx.server).delete(`/api/vendor/products/${v.productId}/images/${other.id}/brand`).set('Cookie', v.cookies)).body as typeof imgs;
    expect(cleared.find((i) => i.id === other.id)!.isBrandImage).toBe(false);
    const detail2 = await get([], `marketplace/products/${prod.slug}`);
    expect(detail2.body.brandImageUrl).toBeNull();
    expect(detail2.body.images.length).toBe(2); // both back in the gallery
  });
});

describe('safe value removal', () => {
  it('requires confirmation to remove a value whose variant has inventory; force removes it', async () => {
    const v = await makeVendorWithProduct('Cap');
    const color = await addOption(v, 'Color', ['Red', 'Blue']);
    await post(v.cookies, `vendor/products/${v.productId}/variants`, { optionValueIds: [color.byValue['Red']], quantity: 5 }).expect(201);
    // removing Red (variant has inventory) without force → 409
    await del(v.cookies, `vendor/products/${v.productId}/option-values/${color.byValue['Red']}`).expect(409);
    // Blue has no variant → removable without force
    await del(v.cookies, `vendor/products/${v.productId}/option-values/${color.byValue['Blue']}`).expect(200);
    // force-remove Red
    const forced = await del(v.cookies, `vendor/products/${v.productId}/option-values/${color.byValue['Red']}?force=true`);
    expect(forced.status).toBe(200);
    expect(forced.body.variants).toHaveLength(0);
  });
});
