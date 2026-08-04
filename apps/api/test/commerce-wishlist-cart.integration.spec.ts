/**
 * Commerce: newest-first sorting + exact-variant Wishlist + cart Move-to-Wishlist
 * (client commerce feedback). Real Postgres. Fixture mirrors the client's example:
 * parent "Bath & Body Works" with variants Hello Beautiful/Large, Perfect in Pink/
 * Medium, Gingham/Small.
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
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function makeApprovedVendor() {
  const email = `v_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'VendorPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const created = await post(cookies, 'vendor/profile', { businessName: `Store ${uniq()}`, contactEmail: email });
  await post(cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${created.body.profile.id}/approve`, {});
  return { cookies, vpId: created.body.profile.id as string };
}
async function makeCustomer() {
  const email = `c_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  return cookiesOf(reg);
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

describe('newest-first product ordering', () => {
  it('marketplace + storefront show most-recently-published first; editing does not move up; explicit sort overrides', async () => {
    const vendor = await makeApprovedVendor();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await post(vendor.cookies, 'vendor/products', { title: `Prod ${i} ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 1000 + i });
      ids.push(r.body.id);
    }
    const [p0, p1, p2] = ids;
    // Force distinct publish times: p0 oldest, p2 newest.
    await ctx.prisma.product.update({ where: { id: p0 }, data: { publishedAt: new Date('2026-01-01T00:00:00Z') } });
    await ctx.prisma.product.update({ where: { id: p1 }, data: { publishedAt: new Date('2026-02-01T00:00:00Z') } });
    await ctx.prisma.product.update({ where: { id: p2 }, data: { publishedAt: new Date('2026-03-01T00:00:00Z') } });

    const order = async (qs = '') => (await guest(`marketplace/products${qs}`)).body.items.map((x: { id: string }) => x.id).filter((x: string) => ids.includes(x));
    // default (newest) = newest published first
    expect(await order()).toEqual([p2, p1, p0]);
    expect(await order('?sort=newest')).toEqual([p2, p1, p0]);

    // editing the OLDEST product (description) must NOT move it up (updatedAt != publishedAt)
    await request(ctx.server).patch(`/api/vendor/products/${p0}`).set('Cookie', vendor.cookies).send({ description: 'edited now' }).expect(200);
    expect(await order()).toEqual([p2, p1, p0]);

    // explicit price sort overrides newest-first (p0<p1<p2 by price)
    expect(await order('?sort=price_asc')).toEqual([p0, p1, p2]);

    // storefront grid is newest-first too
    const slug = (await ctx.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendor.vpId } })).slug;
    const store = await guest(`marketplace/vendors/${slug}`);
    const storeIds = store.body.featuredProducts.map((x: { id: string }) => x.id).filter((x: string) => ids.includes(x));
    expect(storeIds).toEqual([p2, p1, p0]);

    // the vendor's OWN product list (dashboard) is newest-first too, and editing didn't move p0
    const own = await get(vendor.cookies, 'vendor/products');
    const ownIds = own.body.map((x: { id: string }) => x.id).filter((x: string) => ids.includes(x));
    expect(ownIds).toEqual([p2, p1, p0]);
  });
});

/** Build the Bath & Body Works fixture; returns variant ids keyed by label. */
async function bathAndBodyWorks(vendor: { cookies: string[] }) {
  const product = await post(vendor.cookies, 'vendor/products', { title: 'Bath & Body Works', sku: `BBW-${uniq()}`, categoryId, priceMinor: 2000 });
  const productId = product.body.id as string;
  await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Fragrance', values: ['Perfect in Pink', 'Hello Beautiful', 'Gingham'] });
  await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Size', values: ['Medium', 'Large', 'Small'] });
  const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
  const val = (opt: string, v: string) => view.body.options.find((o: { name: string }) => o.name === opt).values.find((x: { value: string }) => x.value === v).id;
  const mk = async (frag: string, size: string, priceMinor: number, qty: number, sku: string) => {
    const r = await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Fragrance', frag), val('Size', size)], sku, quantity: qty, priceMinor });
    // the just-created variant is the last one
    return r.body.variants[0].id as string;
  };
  const pinkMedium = await mk('Perfect in Pink', 'Medium', 2250, 5, 'PIP-M');
  const helloLarge = await mk('Hello Beautiful', 'Large', 2600, 5, 'HB-L');
  const ginghamSmall = await mk('Gingham', 'Small', 1900, 0, 'GING-S'); // out of stock
  const slug = (await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } })).slug;
  return { productId, slug, pinkMedium, helloLarge, ginghamSmall };
}

describe('wishlist saves the EXACT variant', () => {
  it('hearts the exact variant, keeps variants separate, prompts when no variant chosen', async () => {
    const vendor = await makeApprovedVendor();
    const fx = await bathAndBodyWorks(vendor);
    const cust = await makeCustomer();

    // hearting the parent (no variant) on a variant product is rejected — parent never saved
    const parent = await post(cust, `saved/${fx.productId}`);
    expect(parent.status).toBe(400);
    expect(parent.body.message).toMatch(/choose your options/i);

    // heart Perfect in Pink / Medium → saves that EXACT variant
    expect((await post(cust, `saved/${fx.productId}?variantId=${fx.pinkMedium}`)).status).toBe(201);
    // heart Hello Beautiful / Large separately → both coexist
    expect((await post(cust, `saved/${fx.productId}?variantId=${fx.helloLarge}`)).status).toBe(201);

    const list = await get(cust, 'saved');
    const items = list.body.items;
    expect(items.length).toBe(2);
    const pink = items.find((i: { variantId: string }) => i.variantId === fx.pinkMedium);
    expect(pink).toBeTruthy();
    expect(pink.variant.optionLabel).toMatch(/Perfect in Pink/);
    expect(pink.variant.optionLabel).toMatch(/Medium/);
    // Structured option VALUES (ordered) for the shared display formatter — the client
    // formats "Perfect in Pink" / "Medium" from these, never by splitting a label.
    expect(pink.variant.optionValues).toEqual(['Perfect in Pink', 'Medium']);
    expect(pink.variant.priceMinor).toBe(2250); // variant price, not the 2000 parent
    expect(pink.variant.sku).toBe('PIP-M');
    // the parent title never replaces the variant title
    expect(pink.variant.title === 'Bath & Body Works').toBe(false);
    expect(items.some((i: { variantId: string }) => i.variantId === fx.helloLarge)).toBe(true);

    // heart state is per exact variant
    const ids = (await get(cust, 'saved/ids')).body.saved;
    expect(ids).toContainEqual({ productId: fx.productId, variantId: fx.pinkMedium });
    expect(ids).toContainEqual({ productId: fx.productId, variantId: fx.helloLarge });
    expect(ids).not.toContainEqual({ productId: fx.productId, variantId: fx.ginghamSmall });

    // duplicate save of same variant does not create a second entry
    await post(cust, `saved/${fx.productId}?variantId=${fx.pinkMedium}`);
    expect((await get(cust, 'saved')).body.items.length).toBe(2);

    // out-of-stock variant stays visible but flagged unavailable-for-cart via availability
    await post(cust, `saved/${fx.productId}?variantId=${fx.ginghamSmall}`);
    const gingham = (await get(cust, 'saved')).body.items.find((i: { variantId: string }) => i.variantId === fx.ginghamSmall);
    expect(gingham.available).toBe(true); // row present
    expect(gingham.variant.availability.outOfStock).toBe(true);

    // unsave removes only the exact variant
    expect((await del(cust, `saved/${fx.productId}?variantId=${fx.pinkMedium}`)).status).toBe(200);
    const after = (await get(cust, 'saved')).body.items.map((i: { variantId: string }) => i.variantId);
    expect(after).not.toContain(fx.pinkMedium);
    expect(after).toContain(fx.helloLarge);
  });
});

describe('cart Move-to-Wishlist (atomic, exact variant)', () => {
  it('moves the exact variant and removes the line only after a successful save; dedupes', async () => {
    const vendor = await makeApprovedVendor();
    const fx = await bathAndBodyWorks(vendor);
    const cust = await makeCustomer();

    // add Perfect in Pink / Medium to the cart (view is vendor-grouped)
    const added = await post(cust, 'cart/items', { productId: fx.productId, variantId: fx.pinkMedium, quantity: 1 });
    expect(added.status).toBe(201);
    const line = added.body.vendors[0].items[0];
    const itemId = line.id;
    // Cart line carries structured option values (+ raw displayName) for the formatter.
    expect(line.optionValues).toEqual(['Perfect in Pink', 'Medium']);
    expect('displayName' in line).toBe(true);

    // move to wishlist → saved exact variant + cart line gone
    const moved = await post(cust, `cart/items/${itemId}/move-to-wishlist`);
    expect(moved.status).toBe(201);
    expect(moved.body.movedToWishlist).toBe(true);
    expect(moved.body.variantId).toBe(fx.pinkMedium);
    expect(moved.body.itemCount).toBe(0); // cart emptied
    const saved = (await get(cust, 'saved')).body.items;
    expect(saved.some((i: { variantId: string }) => i.variantId === fx.pinkMedium)).toBe(true);

    // add again + move again → already in wishlist: no duplicate, line still removed
    const again = await post(cust, 'cart/items', { productId: fx.productId, variantId: fx.pinkMedium, quantity: 1 });
    const moved2 = await post(cust, `cart/items/${again.body.vendors[0].items[0].id}/move-to-wishlist`);
    expect(moved2.body.alreadySaved).toBe(true);
    expect(moved2.body.itemCount).toBe(0);
    expect((await get(cust, 'saved')).body.items.filter((i: { variantId: string }) => i.variantId === fx.pinkMedium).length).toBe(1);

    // moving a line that isn't the caller's → 404, no state change
    expect((await post(cust, `cart/items/nonexistent-id/move-to-wishlist`)).status).toBe(404);
  });
});
