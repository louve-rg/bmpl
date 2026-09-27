/**
 * Inventory & variants (Phase 2 · M6) — integration against real Postgres.
 * Normalized options/values/variants, transactional inventory adjustments with
 * history + audit, availability derivation, and ownership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { InventoryService } from '../src/products/inventory.service';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let inventoryService: InventoryService;

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
  await request(ctx.server).post('/api/vendor/profile/submit').set('Cookie', cookies).expect(201);
  await request(ctx.server).post(`/api/admin/vendors/${profile.body.profile.id}/approve`).set('Cookie', adminCookies).send({}).expect(201);
  const p = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ title: `${business} Item`, sku: `${business}-1`, categoryId, priceMinor: 1000 });
  return { cookies, productId: p.body.id };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await request(ctx.server).post('/api/admin/categories').set('Cookie', adminCookies).send({ name: 'Apparel' });
  categoryId = cat.body.id;
  inventoryService = ctx.app.get(InventoryService);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('product-level inventory', () => {
  let v: Awaited<ReturnType<typeof makeVendorWithProduct>>;

  it('auto-creates a product-level row (out of stock at zero)', async () => {
    v = await makeVendorWithProduct('inv_v@example.bz', 'Stock');
    const res = await request(ctx.server).get(`/api/vendor/products/${v.productId}/inventory`).set('Cookie', v.cookies);
    expect(res.status).toBe(200);
    expect(res.body.product.quantity).toBe(0);
    expect(res.body.product.outOfStock).toBe(true);
    expect(res.body.product.inStock).toBe(false);
  });

  it('adjusts stock transactionally with history + audit', async () => {
    const up = await request(ctx.server).post(`/api/vendor/products/${v.productId}/inventory/adjust`).set('Cookie', v.cookies).send({ delta: 10, reason: 'RESTOCK' });
    expect(up.status).toBe(201);
    expect(up.body.product.quantity).toBe(10);
    expect(up.body.product.inStock).toBe(true);

    await request(ctx.server).post(`/api/vendor/products/${v.productId}/inventory/adjust`).set('Cookie', v.cookies).send({ delta: -3, reason: 'CORRECTION', note: 'miscount' }).expect(201);

    const hist = await request(ctx.server).get(`/api/vendor/products/${v.productId}/inventory/history`).set('Cookie', v.cookies);
    expect(hist.body.map((h: { reason: string }) => h.reason)).toEqual(expect.arrayContaining(['INITIAL', 'RESTOCK', 'CORRECTION']));
    // LATEST-ROW ASSUMPTION (BMPL-243): no orderBy, no entity scope -- safe
    // only because this is the only/first query for INVENTORY_ADJUSTED in
    // this file. See categories.integration.spec.ts's CATEGORY_CREATED check
    // for the full explanation and what would break it.
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'INVENTORY_ADJUSTED' } });
    expect(audit).toBeTruthy();
  });

  it('refuses to drive on-hand below zero', async () => {
    await request(ctx.server).post(`/api/vendor/products/${v.productId}/inventory/adjust`).set('Cookie', v.cookies).send({ delta: -1000, reason: 'CORRECTION' }).expect(400);
  });

  it('derives low-stock and unlimited/backorder states from settings', async () => {
    // quantity is 7; set threshold 10 -> lowStock
    await request(ctx.server).patch(`/api/vendor/products/${v.productId}/inventory`).set('Cookie', v.cookies).send({ lowStockThreshold: 10 }).expect(200);
    let res = await request(ctx.server).get(`/api/vendor/products/${v.productId}/inventory`).set('Cookie', v.cookies);
    expect(res.body.product.lowStock).toBe(true);

    // unlimited -> always in stock, available null
    await request(ctx.server).patch(`/api/vendor/products/${v.productId}/inventory`).set('Cookie', v.cookies).send({ unlimited: true }).expect(200);
    res = await request(ctx.server).get(`/api/vendor/products/${v.productId}/inventory`).set('Cookie', v.cookies);
    expect(res.body.product.inStock).toBe(true);
    expect(res.body.product.available).toBeNull();
  });
});

describe('normalized variants + variant inventory', () => {
  let v: Awaited<ReturnType<typeof makeVendorWithProduct>>;
  let colorRed: string;
  let sizeS: string;
  let variantId: string;

  it('requires options before variants', async () => {
    v = await makeVendorWithProduct('inv_var@example.bz', 'Var');
    await request(ctx.server).post(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies).send({ optionValueIds: ['clabcabcabcabcabcabcabca'] }).expect(400);
  });

  it('creates options with values', async () => {
    const c = await request(ctx.server).post(`/api/vendor/products/${v.productId}/options`).set('Cookie', v.cookies).send({ name: 'Color', values: ['Red', 'Blue'] });
    expect(c.status).toBe(201);
    await request(ctx.server).post(`/api/vendor/products/${v.productId}/options`).set('Cookie', v.cookies).send({ name: 'Size', values: ['S', 'M'] }).expect(201);
    const view = await request(ctx.server).get(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies);
    const color = view.body.options.find((o: { name: string }) => o.name === 'Color');
    const size = view.body.options.find((o: { name: string }) => o.name === 'Size');
    colorRed = color.values.find((x: { value: string }) => x.value === 'Red').id;
    sizeS = size.values.find((x: { value: string }) => x.value === 'S').id;
  });

  it('rejects an incomplete combination and creates a full one', async () => {
    await request(ctx.server).post(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies).send({ optionValueIds: [colorRed] }).expect(400); // missing Size
    const res = await request(ctx.server).post(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies).send({ optionValueIds: [colorRed, sizeS], sku: 'RED-S', quantity: 5 });
    expect(res.status).toBe(201);
    variantId = res.body.variants[0].id;
    expect(res.body.variants[0].quantity).toBe(5);
  });

  it('rejects a duplicate combination', async () => {
    await request(ctx.server).post(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies).send({ optionValueIds: [sizeS, colorRed] }).expect(409);
  });

  it('adjusts variant inventory independently', async () => {
    const res = await request(ctx.server).post(`/api/vendor/products/${v.productId}/inventory/adjust?variantId=${variantId}`).set('Cookie', v.cookies).send({ delta: 20, reason: 'RESTOCK' });
    expect(res.status).toBe(201);
    const variantInv = res.body.variants.find((x: { variantId: string }) => x.variantId === variantId);
    expect(variantInv.quantity).toBe(25);
  });

  it('blocks option deletion while variants exist', async () => {
    const view = await request(ctx.server).get(`/api/vendor/products/${v.productId}/variants`).set('Cookie', v.cookies);
    const colorOptId = view.body.options.find((o: { name: string }) => o.name === 'Color').id;
    await request(ctx.server).delete(`/api/vendor/products/${v.productId}/options/${colorOptId}`).set('Cookie', v.cookies).expect(409);
  });

  it('exposes options + variants + availability on the public product', async () => {
    // products publish on create; vendor approved by the helper → already public
    const prod = await ctx.prisma.product.findUniqueOrThrow({ where: { id: v.productId } });
    const detail = await request(ctx.server).get(`/api/marketplace/products/${prod.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.options).toHaveLength(2);
    expect(detail.body.variants[0].availability.inStock).toBe(true);
    expect(detail.body.availability.inStock).toBe(true);
  });
});

describe('inventory/variant authorization', () => {
  it('enforces ownership + roles', async () => {
    const a = await makeVendorWithProduct('inv_a@example.bz', 'AInv');
    const b = await makeVendorWithProduct('inv_b@example.bz', 'BInv');
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/inventory`).set('Cookie', b.cookies).expect(404);
    await request(ctx.server).post(`/api/vendor/products/${a.productId}/options`).set('Cookie', b.cookies).send({ name: 'X' }).expect(404);

    const reg = await request(ctx.server).post('/api/auth/register').send({ email: 'inv_c@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
    const customer = cookiesOf(reg);
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/inventory`).set('Cookie', customer).expect(403);
    await request(ctx.server).get(`/api/vendor/products/${a.productId}/inventory`).expect(401);
  });
});

describe('reservation concurrency (BMPL-256)', () => {
  it('two racers for the last unit: exactly one reserves, the other is refused', async () => {
    const v = await makeVendorWithProduct('inv_race@example.bz', 'Race');
    await request(ctx.server)
      .post(`/api/vendor/products/${v.productId}/inventory/adjust`)
      .set('Cookie', v.cookies)
      .send({ delta: 1, reason: 'RESTOCK' })
      .expect(201);
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: v.productId, variantId: null } });

    // Racer A reserves, then holds ITS OWN transaction open for a controlled
    // window before committing — this deterministically widens the race
    // window instead of hoping two Promise.all calls happen to interleave
    // (they often don't reliably: see self-service-funding.integration.spec.ts's
    // own "D" test and its comment on exactly this). Racer B fires at the same
    // moment with no delay of its own.
    const racerA = ctx.prisma.$transaction(async (tx) => {
      await inventoryService.reserve(inv.id, 1, tx);
      await tx.$executeRaw`SELECT pg_sleep(0.3)`;
    });
    // A deliberate head start: without it, whether B's own read happens
    // before or after A's (uncommitted) write depends on which of the two
    // `$transaction` calls happens to acquire a pool connection first — that
    // ordering is not guaranteed, and running this without the head start
    // showed exactly that: it passed once by luck (both racers happened to
    // serialize favourably) even with the lock removed, then correctly
    // reddened on a second run. 50ms is comfortably inside A's 300ms hold
    // and comfortably longer than A's own reserve() call takes.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const racerB = ctx.prisma.$transaction(async (tx) => {
      await inventoryService.reserve(inv.id, 1, tx);
    });

    const results = await Promise.allSettled([racerA, racerB]);
    const outcomes = results.map((r) => r.status);
    expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);

    // Not just "one refused" — the counter itself must land exactly right:
    // one unit reserved, none left, nothing double-booked.
    const after = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.reserved).toBe(1);
    expect(after.quantity - after.reserved).toBe(0);
  });
});
