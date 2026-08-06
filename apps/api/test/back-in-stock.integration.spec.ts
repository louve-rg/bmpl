/**
 * Out-of-stock usability (M-usability). Real Postgres.
 * - "Notify me when back in stock": subscribe (dedup) → restock fires a one-shot
 *   notification and clears the subscription.
 * - Vendor hideOutOfStock: OOS variants drop from the public lineup, a fully-OOS
 *   product 404s + leaves the marketplace list, and both reappear after restock.
 * Existing inventory/checkout logic is untouched.
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
const patch = (c: string[], p: string, b: unknown = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, pw: string) {
  return cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: pw }));
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
  return { cookies, vendorProfileId: created.body.profile.id as string };
}
async function makeCustomer() {
  const email = `c_${uniq()}@ex.bz`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  const cookies = cookiesOf(reg);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies, userId: user.id };
}
/** A simple product (no variants) with a TRACKED product-level on-hand of 0 → out of
 *  stock. (A product with no inventory row is "untracked" = purchasable, so we force
 *  the row into existence by reading the inventory, which creates it at 0.) */
async function makeSimpleProduct(vendor: { cookies: string[] }) {
  const p = await post(vendor.cookies, 'vendor/products', { title: `Item ${uniq()}`, sku: `S-${uniq()}`, categoryId, priceMinor: 2000 });
  const productId = p.body.id as string;
  await get(vendor.cookies, `vendor/products/${productId}/inventory`); // ensures a tracked 0 row
  return { productId, slug: p.body.slug as string };
}
const adjust = (c: string[], productId: string, delta: number, variantId?: string) =>
  post(c, `vendor/products/${productId}/inventory/adjust${variantId ? `?variantId=${variantId}` : ''}`, { delta, reason: 'RESTOCK' });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await login(a.email, a.password);
  categoryId = (await post(admin, 'admin/categories', { name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => { await ctx.app.close(); });

describe('notify me when back in stock', () => {
  it('subscribes (dedup), then a restock fires ONE notification and clears the subscription', async () => {
    const vendor = await makeVendor();
    const { productId } = await makeSimpleProduct(vendor); // on-hand 0 → out of stock
    const cust = await makeCustomer();

    // subscribe twice → exactly one subscription (dedup)
    expect((await post(cust.cookies, `back-in-stock/${productId}`)).status).toBe(201);
    expect((await post(cust.cookies, `back-in-stock/${productId}`)).status).toBe(201);
    expect((await get(cust.cookies, 'back-in-stock/ids')).body.subscriptions).toHaveLength(1);
    expect(await ctx.prisma.backInStockSubscription.count({ where: { userId: cust.userId, productId } })).toBe(1);

    // no back-in-stock notification yet
    const before = await ctx.prisma.notificationRecipient.count({
      where: { userId: cust.userId, notification: { event: 'BACK_IN_STOCK' } },
    });
    expect(before).toBe(0);

    // vendor restocks: 0 → 5 crosses into stock → notify + clear (one-shot)
    expect((await adjust(vendor.cookies, productId, 5)).status).toBe(201);

    expect(await ctx.prisma.notificationRecipient.count({
      where: { userId: cust.userId, notification: { event: 'BACK_IN_STOCK' } },
    })).toBe(1);
    expect((await get(cust.cookies, 'back-in-stock/ids')).body.subscriptions).toHaveLength(0);

    // a further adjustment (already in stock) does NOT re-notify (subscription is gone)
    await adjust(vendor.cookies, productId, 3);
    expect(await ctx.prisma.notificationRecipient.count({
      where: { userId: cust.userId, notification: { event: 'BACK_IN_STOCK' } },
    })).toBe(1);
  });

  it('subscribes to an EXACT variant and notifies only on that variant restock; unsubscribe works', async () => {
    const vendor = await makeVendor();
    const p = await post(vendor.cookies, 'vendor/products', { title: `Bag ${uniq()}`, sku: `B-${uniq()}`, categoryId, priceMinor: 3000 });
    const productId = p.body.id as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Color', values: ['Red', 'Blue'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const val = (v: string) => view.body.options[0].values.find((x: { value: string }) => x.value === v).id;
    const red = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Red')], sku: 'RED', quantity: 0 })).body.variants[0].id;
    const blue = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Blue')], sku: 'BLUE', quantity: 0 })).body.variants[0].id;
    const cust = await makeCustomer();

    expect((await post(cust.cookies, `back-in-stock/${productId}?variantId=${red}`)).status).toBe(201);

    // restocking the OTHER variant (blue) must NOT notify the red subscriber
    await adjust(vendor.cookies, productId, 4, blue);
    expect(await ctx.prisma.notificationRecipient.count({ where: { userId: cust.userId, notification: { event: 'BACK_IN_STOCK' } } })).toBe(0);
    expect((await get(cust.cookies, 'back-in-stock/ids')).body.subscriptions).toHaveLength(1);

    // unsubscribe, then restock red → no notification (unsubscribed)
    expect((await del(cust.cookies, `back-in-stock/${productId}?variantId=${red}`)).status).toBe(200);
    await adjust(vendor.cookies, productId, 4, red);
    expect(await ctx.prisma.notificationRecipient.count({ where: { userId: cust.userId, notification: { event: 'BACK_IN_STOCK' } } })).toBe(0);
  });
});

describe('vendor hideOutOfStock visibility', () => {
  it('hides OOS variants from the lineup, 404s a fully-OOS product, and restores on restock', async () => {
    const vendor = await makeVendor();
    await patch(vendor.cookies, 'vendor/settings', { hideOutOfStock: true });

    // variant product: Red in stock, Blue out of stock
    const p = await post(vendor.cookies, 'vendor/products', { title: `Shoe ${uniq()}`, sku: `SH-${uniq()}`, categoryId, priceMinor: 5000 });
    const productId = p.body.id as string;
    const slug = p.body.slug as string;
    await post(vendor.cookies, `vendor/products/${productId}/options`, { name: 'Color', values: ['Red', 'Blue'] });
    const view = await get(vendor.cookies, `vendor/products/${productId}/variants`);
    const val = (v: string) => view.body.options[0].values.find((x: { value: string }) => x.value === v).id;
    const red = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Red')], sku: 'R', quantity: 5 })).body.variants[0].id;
    const blue = (await post(vendor.cookies, `vendor/products/${productId}/variants`, { optionValueIds: [val('Blue')], sku: 'B', quantity: 0 })).body.variants[0].id;

    // public detail: only the in-stock (Red) variant is visible
    let detail = await guest(`marketplace/products/${slug}`);
    expect(detail.status).toBe(200);
    expect((detail.body.variants as Array<{ id: string }>).map((v) => v.id)).toEqual([red]);
    expect((detail.body.variants as Array<{ id: string }>).some((v) => v.id === blue)).toBe(false);

    // restock Blue → it reappears
    await adjust(vendor.cookies, productId, 3, blue);
    detail = await guest(`marketplace/products/${slug}`);
    expect((detail.body.variants as Array<{ id: string }>).map((v) => v.id).sort()).toEqual([blue, red].sort());

    // a fully out-of-stock SIMPLE product is hidden (404) and absent from the marketplace list,
    // then reappears after a restock.
    const simple = await makeSimpleProduct(vendor); // on-hand 0
    expect((await guest(`marketplace/products/${simple.slug}`)).status).toBe(404);
    const listBefore = (await guest(`marketplace/products`)).body.items as Array<{ slug: string }>;
    expect(listBefore.some((x) => x.slug === simple.slug)).toBe(false);

    await adjust(vendor.cookies, simple.productId, 7);
    expect((await guest(`marketplace/products/${simple.slug}`)).status).toBe(200);
    const listAfter = (await guest(`marketplace/products`)).body.items as Array<{ slug: string }>;
    expect(listAfter.some((x) => x.slug === simple.slug)).toBe(true);
  });

  it('DEFAULT (hideOutOfStock off): an OOS product stays visible (Option 1 behavior)', async () => {
    const vendor = await makeVendor(); // default hideOutOfStock = false
    const { slug } = await makeSimpleProduct(vendor); // on-hand 0
    const detail = await guest(`marketplace/products/${slug}`);
    expect(detail.status).toBe(200); // still visible
    expect(detail.body.availability.outOfStock).toBe(true); // marked OOS (badge + notify-me on the web)
  });
});
