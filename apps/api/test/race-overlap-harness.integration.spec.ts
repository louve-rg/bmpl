/**
 * Exercises raceWithRequiredOverlap (test/helpers.ts) against a real,
 * already-known-safe concurrency guard, so the harness itself is run by CI
 * rather than sitting unused. Not a new concurrency finding — reserve()'s
 * SELECT...FOR UPDATE (BMPL-256) is already proven to guard oversell; this
 * file's job is to prove the harness, not the guard.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, raceWithRequiredOverlap, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  if (reg.status !== 201) throw new Error(`register failed ${reg.status}: ${JSON.stringify(reg.body)}`);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`raceharness_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `RaceHarness Store ${s}`,
      slug: `raceharness-store-${s}`,
      contactEmail: `raceharnessv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  return { vendorProfileId: vp.id as string, vendorCookies: cookies };
}

async function makeProduct(vendorProfileId: string, quantity: number) {
  const s = uniq();
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId,
      categoryId,
      title: `RaceHarness Prod ${s}`,
      slug: `raceharness-prod-${s}`,
      sku: `RHP-${s}`,
      status: 'PUBLISHED',
      priceMinor: 1000n,
      currency: 'BZD',
      inventory: { create: { quantity, reserved: 0, unlimited: false } },
    },
  });
  return product.id as string;
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'FLOOR-RACE-TEST-HARNESS fixture' });
  if (r.status !== 201) throw new Error(`fund failed ${r.status}: ${JSON.stringify(r.body)}`);
}

async function inv(productId: string) {
  return ctx.prisma.inventory.findFirstOrThrow({ where: { productId }, select: { quantity: true, reserved: true } });
}

beforeAll(async () => {
  ctx = await bootApp();
  await seedRoles(ctx.prisma);
  // Fixture admin created in THIS run, not a login against a seeded account
  // CI's own seed step may not produce — same pattern as
  // wallet-activation.integration.spec.ts and others.
  const a = await seedSuperAdmin(ctx.prisma, `raceharness_admin_${uniq()}@example.bz`);
  const adminLogin = await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password });
  if (adminLogin.status !== 200 && adminLogin.status !== 201) throw new Error(`admin login failed ${adminLogin.status}: ${JSON.stringify(adminLogin.body)}`);
  admin = cookiesOf(adminLogin);
  const cat = await post(admin, 'admin/categories', { name: `RaceHarness ${uniq()}` });
  if (cat.status !== 201) throw new Error(`category create failed ${cat.status}: ${JSON.stringify(cat.body)}`);
  categoryId = cat.body.id;
}, 60_000);

afterAll(async () => ctx.app.close());

describe('raceWithRequiredOverlap', () => {
  it('fails the proof, not just the assertion, if the guard it exercises stops serialising concurrent writers', async () => {
    const { vendorProfileId } = await makeVendor();
    const productId = await makeProduct(vendorProfileId, 1);
    const buyers = await Promise.all([
      registerCustomer(`raceharness_b1_${uniq()}@example.bz`),
      registerCustomer(`raceharness_b2_${uniq()}@example.bz`),
    ]);
    for (const b of buyers) {
      await fund(b.userId, 5000);
      const add = await post(b.cookies, 'cart/items', { productId, quantity: 1 });
      if (add.status !== 201) throw new Error(`add to cart failed ${add.status}: ${JSON.stringify(add.body)}`);
    }

    // This is the contract under test: if pg_stat_activity never observes
    // 2+ backends active at once, raceWithRequiredOverlap throws here and
    // the test fails loudly as inconclusive, instead of silently falling
    // through to the correctness assertions below with nothing proven.
    const probe = await raceWithRequiredOverlap(
      ctx.prisma,
      buyers.map((b) => () => post(b.cookies, 'checkout', { vendors: [{ vendorProfileId, deliveryMethod: 'PICKUP' }], payWithWallet: true })),
    );
    expect(probe.peakConcurrentActive).toBeGreaterThanOrEqual(2);

    const after = await inv(productId);
    const successes = probe.responses.filter((r) => r.status === 201).length;
    // The actual guard being exercised: reserve()'s SELECT...FOR UPDATE on
    // the inventory row (BMPL-256) — exactly one of two concurrent buyers
    // for the last unit succeeds, never both, never zero.
    expect(successes).toBe(1);
    expect(after.reserved).toBe(1);
    expect(after.quantity).toBe(1);
  }, 30_000);
});
