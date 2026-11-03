/**
 * SHIPPING-E2E — checkout's wallet-paid path, owner-approved fix. The money
 * side of checkout had the IDENTICAL pair of races the shipping path had
 * (`PaymentsService.createForOrder`'s own comment), confirmed LIVE on
 * unmodified `main` by reproducing both with real concurrent HTTP checkouts
 * before writing any fix — not inferred from the shipping result, since the
 * owner's condition was to inspect checkout's actual transaction boundaries
 * rather than assume they match shipping's.
 *
 * One boundary difference that matters here and has no equivalent in
 * shipping: `InventoryService.reserve`'s own `FOR UPDATE` on the inventory
 * row (BMPL-256) runs early in checkout's transaction, for any TRACKED
 * product — this incidentally serializes concurrent checkouts of that
 * product before any of them could reach the wallet code together, which is
 * why the concurrency test below deliberately uses an UNLIMITED product: a
 * tracked, limited-stock checkout never reaches the deadlock-prone window in
 * the first place, so it cannot exercise the fix.
 *
 * The locked-wallet refusal regression for checkout already exists in
 * wallet-lock-enforcement.integration.spec.ts ("refuses POST /orders/checkout
 * with payWithWallet:true...") — re-run as part of this change, not
 * duplicated here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

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
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`cwp_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Wallet Pay Store ${s}`,
      slug: `wallet-pay-store-${s}`,
      contactEmail: `cwpv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  return vp.id as string;
}

async function makeProduct(vendorProfileId: string, opts: { unlimited: boolean }) {
  const s = uniq();
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId,
      categoryId,
      title: `Wallet Pay Prod ${s}`,
      slug: `wallet-pay-prod-${s}`,
      sku: `WPP-${s}`,
      status: 'PUBLISHED',
      priceMinor: 1000n,
      currency: 'BZD',
      inventory: { create: { quantity: opts.unlimited ? 0 : 1000, reserved: 0, unlimited: opts.unlimited } },
    },
  });
  return product.id as string;
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'checkout-wallet-payments fixture' });
  expect(r.status).toBe(201);
}

const walletOf = async (userId: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER' } });
const balanceOf = async (accountId: string) => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};

const checkoutOf = (vendorProfileId: string) => ({
  vendors: [{ vendorProfileId, deliveryMethod: 'PICKUP' }],
  payWithWallet: true,
});

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const cat = await post(admin, 'admin/categories', { name: `Wallet Pay ${uniq()}` });
  categoryId = cat.body.id;
});
afterAll(async () => ctx.app.close());

describe('a single wallet-paid checkout', () => {
  it('escrows the exact total exactly once, and the response shape is unchanged', async () => {
    const vendorProfileId = await makeVendor();
    const productId = await makeProduct(vendorProfileId, { unlimited: false });
    const customer = await registerCustomer(`cwp_single_${uniq()}@example.bz`);
    await fund(customer.userId, 5000);

    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    const res = await post(customer.cookies, 'checkout', checkoutOf(vendorProfileId));
    expect(res.status).toBe(201);

    // Exactly the fields the pre-existing suite (orders.integration.spec.ts)
    // already pins for a non-wallet checkout — the wallet-paid path returns
    // the same order shape, unchanged by this fix.
    expect(res.body).toMatchObject({
      status: 'PENDING',
      itemCount: 1,
      subtotalMinor: 1000,
      totalMinor: 1000,
    });
    expect(res.body.vendorOrders).toHaveLength(1);
    expect(typeof res.body.id).toBe('string');

    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(1);
    const wallet = await walletOf(customer.userId);
    expect(await balanceOf(wallet.id)).toBe(4000n); // funded 5000, escrow debit of 1000, exactly once
  });
});

describe("a repeat customer's concurrent wallet-paid checkouts", () => {
  it('never deadlock the wallet row or return a raw 500', async () => {
    const vendorProfileId = await makeVendor();
    // UNLIMITED, deliberately — see the file header: a TRACKED row's own
    // reserve() lock would serialize these before any could reach the
    // wallet code together, masking the exact mechanism under test.
    const productId = await makeProduct(vendorProfileId, { unlimited: true });
    const customer = await registerCustomer(`cwp_concurrent_${uniq()}@example.bz`);
    await fund(customer.userId, 10_000);

    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    const first = await post(customer.cookies, 'checkout', checkoutOf(vendorProfileId));
    expect(first.status).toBe(201); // establishes the PaymentMethod row -- now a "repeat" customer

    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(customer.cookies, 'checkout', checkoutOf(vendorProfileId))),
    );
    for (const r of results) expect(r.status).toBe(201);

    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(5); // the first checkout + 4 more
    const wallet = await walletOf(customer.userId);
    expect(await balanceOf(wallet.id)).toBe(5000n); // funded 10000, 5 x 1000 debited, never more, never a lost or duplicated debit
  });
});
