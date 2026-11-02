/**
 * SHIPPING-E2E — the admin wallet-lock control (`setUserWalletLock`,
 * `WalletService`) is documented as removing a wallet's permission to
 * ORIGINATE new movement. In production it did not: a locked wallet still
 * authorized a shipment booking and a checkout, because `escrowInTx`
 * (`payments.service.ts`) — the one sink every customer-wallet debit passes
 * through — never read `wallet.status`. Only `authorize()`'s own
 * pre-transaction check did, and `orders.service.ts`'s `runCheckout()` and
 * `shipment.service.ts`'s `runCreate()` call `escrowInTx` directly, with no
 * copy of that check of their own.
 *
 * The fix enforces the lock inside `escrowInTx` itself, reusing the same
 * rejection wording `authorize()` already produces (`walletStatusRejectReason`),
 * so every caller gets the same refusal shape for the same condition.
 *
 * `escrowInTx` only ever ORIGINATES money (customer → escrow). Release
 * (`releaseFor` / `releaseForOrder` / `releaseForShipment`, escrow →
 * customer) never reaches it and is deliberately left unchecked — a locked
 * customer must still be able to get an unspent hold back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

const localParcel = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
  destination: { district: 'BELIZE', city: 'Belize City', address: '18 Newtown Barracks', name: 'Recipient', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeVendor(email: string, business: string) {
  const { cookies } = await registerCustomer(email);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await post(cookies, 'vendor/profile', { businessName: business, contactEmail: email });
  expect(profile.status).toBe(201);
  await post(cookies, 'vendor/profile/submit', {}).then((r) => expect(r.status).toBe(201));
  await post(admin, `admin/vendors/${profile.body.profile.id}/approve`, {}).then((r) => expect(r.status).toBe(201));
  await request(ctx.server).patch('/api/vendor/profile').set('Cookie', cookies).send({ storeStatus: 'OPEN' }).expect(200);
  return { cookies, vpId: profile.body.profile.id };
}

async function createProduct(cookies: string[], fields: Record<string, unknown>) {
  const res = await request(ctx.server).post('/api/vendor/products').set('Cookie', cookies).send({ categoryId, ...fields });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const setStock = (cookies: string[], productId: string, delta: number) =>
  request(ctx.server).post(`/api/vendor/products/${productId}/inventory/adjust`).set('Cookie', cookies).send({ delta, reason: 'RESTOCK' }).expect(201);

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'wallet-lock-enforcement fixture' });
  expect(r.status).toBe(201);
}

async function lockWallet(userId: string) {
  const r = await post(admin, `admin/wallet/users/${userId}/lock`, { reason: 'Fixture: wallet-lock-enforcement test' });
  expect(r.status).toBe(201);
  expect(r.body.status).toBe('LOCKED');
}

const walletOf = async (userId: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER' } });
const balanceOf = async (accountId: string) => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};

const PRICE = 1500; // BZ$15.00 local courier fee

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const cat = await post(admin, 'admin/categories', { name: 'General' });
  categoryId = cat.body.id;
  const fee = await request(ctx.server)
    .patch('/api/admin/ops/settings')
    .set('Cookie', admin)
    .send({ localCourierFeeMinor: PRICE, localCourierFeeTestMinor: PRICE, localCourierMinutes: 60 });
  expect(fee.status).toBe(200);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('a locked wallet is refused on origination', () => {
  it('refuses POST /shipping with payWithWallet:true, creates no shipment/payment/hold, and moves no money', async () => {
    const customer = await registerCustomer(`walletlock_ship_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    await lockWallet(customer.userId);
    const wallet = await walletOf(customer.userId);
    const balanceBefore = await balanceOf(wallet.id);

    const r = await post(customer.cookies, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/wallet is locked/i);

    // Same refusal shape authorize() already produces for this condition.
    const authRefusal = await ctx.prisma.auditLog.count({ where: { action: 'WALLET_VALIDATION_FAILED' } });
    expect(authRefusal).toBe(0); // this path never reaches authorize()'s pre-check at all

    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customer.userId } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(0);
    expect(await ctx.prisma.walletHold.findMany({ where: { walletAccountId: wallet.id } })).toHaveLength(0);
    expect(await balanceOf(wallet.id)).toBe(balanceBefore);
  });

  it('refuses POST /orders/checkout with payWithWallet:true, creates no order, and moves no money — the path Dwight proved broken in production', async () => {
    const customer = await registerCustomer(`walletlock_checkout_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const vendor = await makeVendor(`walletlock_vendor_${uniq()}@example.com`, 'WalletLockShop');
    const productId = await createProduct(vendor.cookies, { title: 'Lockable', sku: `LOCK-${uniq()}`, priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    await lockWallet(customer.userId);
    const wallet = await walletOf(customer.userId);
    const balanceBefore = await balanceOf(wallet.id);

    const r = await post(customer.cookies, 'checkout', { payWithWallet: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/wallet is locked/i);

    // The whole checkout transaction rolled back — no order, exactly as
    // orders.service.ts's own comment on the escrowInTx call promises.
    expect(await ctx.prisma.order.count({ where: { userId: customer.userId } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(0);
    expect(await balanceOf(wallet.id)).toBe(balanceBefore);
  });
});

describe('a release/cancellation on a locked wallet still succeeds', () => {
  it('cancelling an unstarted shipment refunds the hold even while the wallet is locked', async () => {
    const customer = await registerCustomer(`walletlock_shiprefund_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const booked = await post(customer.cookies, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(booked.status).toBe(201);
    const wallet = await walletOf(customer.userId);
    const balanceAfterBooking = await balanceOf(wallet.id);
    expect(balanceAfterBooking).toBe(10_000n - BigInt(PRICE));

    await lockWallet(customer.userId);

    const cancel = await post(customer.cookies, `shipping/${booked.body.id}/cancel`, { reason: 'Changed my mind.' });
    expect(cancel.status).toBe(201);

    expect(await balanceOf(wallet.id)).toBe(10_000n); // full refund, locked or not
    const hold = await ctx.prisma.walletHold.findFirstOrThrow({ where: { walletAccountId: wallet.id } });
    expect(hold.status).toBe('RELEASED');
  });

  it('releasing a marketplace order\'s reservation refunds escrow even while the wallet is locked', async () => {
    const customer = await registerCustomer(`walletlock_orderrefund_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const vendor = await makeVendor(`walletlock_vendor2_${uniq()}@example.com`, 'WalletLockShop2');
    const productId = await createProduct(vendor.cookies, { title: 'Refundable', sku: `REF-${uniq()}`, priceMinor: 5000 });
    await setStock(vendor.cookies, productId, 5);
    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    const checkout = await post(customer.cookies, 'checkout', { payWithWallet: true });
    expect(checkout.status).toBe(201);
    const wallet = await walletOf(customer.userId);
    expect(await balanceOf(wallet.id)).toBe(5000n); // 10000 - 5000 escrowed

    await lockWallet(customer.userId);

    const release = await post(admin, `admin/orders/${checkout.body.id}/release-reservations`, {});
    expect(release.status).toBe(201);

    expect(await balanceOf(wallet.id)).toBe(10_000n); // escrow returned in full, locked or not
  });
});

describe('an unlocked wallet is entirely unaffected', () => {
  it('books and charges normally with no lock ever applied', async () => {
    const customer = await registerCustomer(`walletlock_unaffected_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);

    const r = await post(customer.cookies, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(201);

    const wallet = await walletOf(customer.userId);
    expect(await balanceOf(wallet.id)).toBe(10_000n - BigInt(PRICE));
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    expect(payment.status).toBe('AUTHORIZED');
  });
});
