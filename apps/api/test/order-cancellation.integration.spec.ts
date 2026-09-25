/**
 * Customer order cancellation (owner-approved scope), against real Postgres.
 *
 * The claims this suite defends: a customer cancels their WHOLE order, and
 * only while EVERY vendor-order is still PENDING — the window shuts atomically
 * the moment a vendor begins preparing (conditional in-transaction write, the
 * standing race pattern). Money moves only through the EXISTING release path:
 * a never-authorized payment releases its soft hold with zero ledger movement;
 * a wallet-paid order returns funds through the balanced escrow→customer
 * ESCROW_RELEASE, payment ending CANCELLED — proven here by the returned money
 * being SPENDABLE AGAIN. Within the window a payment can never be SETTLING or
 * SETTLED (capture starts at pickup confirmation, which requires
 * READY_FOR_PICKUP — outside the window): unreachable by construction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Vendor + published product with stock, delivery priced (raw onboarding — separately tested). */
async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`ocx_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Cancel Store ${s}`,
      slug: `cancel-store-${s}`,
      contactEmail: `ocxv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Cancel Prod ${s}`, slug: `cancel-prod-${s}`, sku: `CP-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, vendorCookies: cookies, productId: product.id };
}

/** Funded customer with the vendor's product in the cart, checked out. */
async function checkout(vendors: Array<Awaited<ReturnType<typeof makeVendor>>>, opts: { pay: boolean; fund?: boolean }) {
  const s = uniq();
  const customer = await registerCustomer(`ocx_c${s}@example.bz`);
  if (opts.fund !== false) {
    await post(adminCookies, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 100_000, reason: 'Cancellation fixture.' });
  }
  for (const v of vendors) {
    await post(customer.cookies, 'cart/items', { productId: v.productId, quantity: 2 }).expect(201);
  }
  const res = await post(customer.cookies, 'checkout', {
    vendors: vendors.map((v) => ({ vendorProfileId: v.vendorProfileId, deliveryMethod: 'DELIVERY' })),
    deliveryAddress: { fullName: 'Cancel Customer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' },
    payWithWallet: opts.pay,
  }).expect(201);
  return { customer, orderId: res.body.id as string, body: res.body };
}

const cancel = (customer: { cookies: string[] }, orderId: string, reason?: string) =>
  post(customer.cookies, `orders/${orderId}/cancel`, reason ? { reason } : {});

const orderRow = (orderId: string) =>
  ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { vendorOrders: true, payment: true } });

const releaseTxnCount = (paymentId: string) =>
  ctx.prisma.walletTransaction.count({ where: { reference: `payment:${paymentId}:release` } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await ctx.prisma.category.create({ data: { name: 'Cancel General', slug: `cancel-gen-${uniq()}` } });
  categoryId = cat.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('who may cancel', () => {
  it('a foreign order reads exactly like a missing one — and, underneath, is truly untouched', async () => {
    const vendor = await makeVendor();
    const { orderId } = await checkout([vendor], { pay: true });
    const stranger = await registerCustomer(`ocx_s${uniq()}@example.bz`);
    const before = await orderRow(orderId);
    const invBefore = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: vendor.productId } });

    const foreign = await cancel(stranger, orderId);
    const missing = await cancel(stranger, 'nonexistent00000000000000');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);

    // The HTTP shape alone is not proof: `cancelOwn`'s own ownership check
    // must be what stops the stranger, not a coincidental 404 thrown by the
    // unrelated `getOwn` tail-call AFTER the cancellation already committed.
    // If it were the latter, the order and its money would be for-real
    // cancelled underneath a response that looks identical to a clean 404 —
    // so assert the victim's order, vendor-orders and payment/hold state are
    // byte-for-byte unchanged, not just that the HTTP status matches.
    const after = await orderRow(orderId);
    expect(after.status).toBe(before.status);
    expect(after.reservationsReleasedAt).toEqual(before.reservationsReleasedAt);
    expect(after.vendorOrders.map((vo) => ({ id: vo.id, status: vo.status }))).toEqual(
      before.vendorOrders.map((vo) => ({ id: vo.id, status: vo.status })),
    );
    expect(after.payment!.status).toBe(before.payment!.status);
    expect(await releaseTxnCount(before.payment!.id)).toBe(0);
    const invAfter = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: vendor.productId } });
    expect(invAfter.reserved).toBe(invBefore.reserved);
  });
});

describe('inside the window', () => {
  it('an unpaid order cancels with ZERO ledger movement: stock back, hold released, payment cancelled', async () => {
    const vendor = await makeVendor();
    const { customer, orderId } = await checkout([vendor], { pay: false, fund: false });
    const r = await cancel(customer, orderId, 'Changed my mind.');
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('CANCELLED');

    const row = await orderRow(orderId);
    expect(row.status).toBe('CANCELLED');
    expect(row.vendorOrders.every((vo) => vo.status === 'CANCELLED')).toBe(true);
    const payment = row.payment!;
    expect(payment.status).toBe('CANCELLED');
    // The soft hold was released and NO money ever moved — no release
    // transaction exists because there was nothing in escrow to return.
    expect(await releaseTxnCount(payment.id)).toBe(0);
    const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: vendor.productId } });
    expect(inv.reserved).toBe(0);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'ORDER_CANCELLED' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.actorId).toBe(customer.userId);
  });

  it('a wallet-paid order returns its money through the EXISTING balanced escrow release — and the money is spendable again', async () => {
    const vendor = await makeVendor();
    const { customer, orderId } = await checkout([vendor], { pay: true });
    const paid = await orderRow(orderId);
    expect(paid.payment!.status).toBe('AUTHORIZED');

    expect((await cancel(customer, orderId)).status).toBe(201);
    const row = await orderRow(orderId);
    const payment = row.payment!;
    expect(payment.status).toBe('CANCELLED');
    // Exactly one balanced escrow→customer return, by its unique reference.
    expect(await releaseTxnCount(payment.id)).toBe(1);
    const txn = await ctx.prisma.walletTransaction.findFirstOrThrow({
      where: { reference: `payment:${payment.id}:release` },
      include: { entries: true },
    });
    expect(txn.type).toBe('ESCROW_RELEASE');
    const net = txn.entries.reduce((s, e) => s + (e.direction === 'DEBIT' ? -e.amountMinor : e.amountMinor), 0n);
    expect(net).toBe(0n);

    // The proof that money really came back: the same funds buy again.
    await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 2 }).expect(201);
    await post(customer.cookies, 'checkout', {
      vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: { fullName: 'Cancel Customer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' },
      payWithWallet: true,
    }).expect(201);
  });

  it('cancels the attached delivery and takes it out of dispatch reach; a second cancel is a harmless replay', async () => {
    const vendor = await makeVendor();
    const { customer, orderId } = await checkout([vendor], { pay: true });
    expect((await cancel(customer, orderId)).status).toBe(201);
    const delivery = await ctx.prisma.orderDelivery.findFirstOrThrow({ where: { vendorOrder: { orderId } } });
    expect(delivery.status).toBe('CANCELLED');
    expect(delivery.readyForDispatchAt).toBeNull();
    expect(delivery.offerExpiresAt).toBeNull();
    // Idempotent second press.
    const again = await cancel(customer, orderId);
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('CANCELLED');
    expect(await releaseTxnCount((await orderRow(orderId)).payment!.id)).toBe(1); // still exactly one
  });
});

describe('the window shuts when the vendor begins', () => {
  it('a vendor who started preparing blocks cancellation, and the escrow stays put', async () => {
    const vendor = await makeVendor();
    const { customer, orderId } = await checkout([vendor], { pay: true });
    const vo = (await orderRow(orderId)).vendorOrders[0]!;
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/start-preparing`)).status).toBe(201);

    const refused = await cancel(customer, orderId);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('started preparing');
    const after = await orderRow(orderId);
    expect(after.status).toBe('PENDING');
    expect(after.vendorOrders[0]!.status).toBe('PREPARING');
    expect(after.payment!.status).toBe('AUTHORIZED'); // money untouched
    expect(await releaseTxnCount(after.payment!.id)).toBe(0);
  });

  it('multi-vendor: ONE vendor starting shuts the whole-order window — the untouched vendor-order stays exactly as it was', async () => {
    const a = await makeVendor();
    const b = await makeVendor();
    const { customer, orderId } = await checkout([a, b], { pay: true });
    const row = await orderRow(orderId);
    const voA = row.vendorOrders.find((v) => v.vendorProfileId === a.vendorProfileId)!;
    expect((await post(a.vendorCookies, `vendor/orders/${voA.id}/start-preparing`)).status).toBe(201);

    expect((await cancel(customer, orderId)).status).toBe(409);
    const after = await orderRow(orderId);
    expect(after.vendorOrders.find((v) => v.vendorProfileId === a.vendorProfileId)!.status).toBe('PREPARING');
    // The race pattern's rollback: the PENDING flip on B was undone with the tx.
    expect(after.vendorOrders.find((v) => v.vendorProfileId === b.vendorProfileId)!.status).toBe('PENDING');
  });

  it('READY_FOR_PICKUP is far outside the window', async () => {
    const vendor = await makeVendor();
    const { customer, orderId } = await checkout([vendor], { pay: true });
    const vo = (await orderRow(orderId)).vendorOrders[0]!;
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/start-preparing`)).status).toBe(201);
    expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);
    expect((await cancel(customer, orderId)).status).toBe(409);
  });
});
