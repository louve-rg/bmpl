/**
 * A cancelled order must never be resurrected by a vendor write racing it.
 *
 * `startPreparing` and `markReady` (vendor-fulfilment.service.ts) each do a
 * read-then-write: read the vendor-order, decide it's still PENDING/PREPARING,
 * then write. If a customer's `cancelOwn` commits in the gap between that read
 * and the write, an UNCONDITIONAL `where: { id }` write would silently flip
 * the just-CANCELLED vendor-order back to PREPARING or READY_FOR_PICKUP — and
 * for `markReady`, also re-arm dispatch (`readyForDispatchAt`) for an order
 * the customer has already been told is cancelled and refunded.
 *
 * A SEQUENTIAL "cancel, then call the vendor route" cannot exercise this: the
 * vendor route's own pre-existing status check re-reads fresh and would
 * already see CANCELLED, refusing correctly whether or not the WRITE itself
 * is guarded — proving nothing about the write. So each test here pauses the
 * vendor write itself, via a one-shot Prisma query middleware, until AFTER
 * the customer's cancellation has fully committed, then releases it — the
 * vendor's request was already past its own read (decided PENDING) when the
 * cancellation commits, exactly as the reviewer's finding described.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Prisma } from '@bmpl/database';

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

async function makeVendor() {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`vfr_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Race Store ${s}`,
      slug: `race-store-${s}`,
      contactEmail: `vfrv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Race Prod ${s}`, slug: `race-prod-${s}`, sku: `RP-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, vendorCookies: cookies, productId: product.id };
}

async function checkout(vendor: Awaited<ReturnType<typeof makeVendor>>) {
  const s = uniq();
  const customer = await registerCustomer(`vfr_c${s}@example.bz`);
  await post(adminCookies, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 100_000, reason: 'Race fixture.' });
  await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 2 }).expect(201);
  const res = await post(customer.cookies, 'checkout', {
    vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
    deliveryAddress: { fullName: 'Race Customer', phone: '+5017770000', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' },
    payWithWallet: true,
  }).expect(201);
  const orderId = res.body.id as string;
  const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId } });
  return { customer, orderId, vendorOrderId: vo.id };
}

const cancel = (customer: { cookies: string[] }, orderId: string) => post(customer.cookies, `orders/${orderId}/cancel`, {});

/**
 * Pauses the FIRST `VendorOrder.update`/`updateMany` targeting `vendorOrderId`
 * — the write, never the preceding read — until `release()` is called.
 * `reached` resolves once that write has actually been intercepted, so the
 * test can deterministically wait for "the vendor's request is now paused at
 * its write" before letting the cancellation run, with no arbitrary timeout.
 */
function pauseVendorWrite(prismaService: PrismaService, vendorOrderId: string) {
  let resolveReached!: () => void;
  const reached = new Promise<void>((res) => {
    resolveReached = res;
  });
  let releaseGate!: () => void;
  const gate = new Promise<void>((res) => {
    releaseGate = res;
  });
  let intercepted = false;
  const middleware: Prisma.Middleware = async (params, next) => {
    const targetsRow = (params.args as { where?: { id?: string } } | undefined)?.where?.id === vendorOrderId;
    // eslint-disable-next-line no-console
    console.log('[DEBUG mw]', params.model, params.action, JSON.stringify(params.args?.where ?? {}));
    if (!intercepted && params.model === 'VendorOrder' && (params.action === 'update' || params.action === 'updateMany') && targetsRow) {
      intercepted = true;
      resolveReached();
      await gate;
    }
    return next(params);
  };
  prismaService.$use(middleware);
  return { reached, release: () => releaseGate() };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  const cat = await ctx.prisma.category.create({ data: { name: 'Race General', slug: `race-gen-${uniq()}` } });
  categoryId = cat.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('a vendor write racing a customer cancellation', () => {
  it('startPreparing loses the race: the vendor-order stays CANCELLED, not PREPARING', async () => {
    const vendor = await makeVendor();
    const { customer, orderId, vendorOrderId } = await checkout(vendor);
    const prismaService = ctx.app.get(PrismaService);
    const { reached, release } = pauseVendorWrite(prismaService, vendorOrderId);

    // The vendor's request is already in flight — it has read PENDING and
    // decided to write — when we let the customer's cancellation run.
    // Promise.resolve(...) forces supertest's lazily-started Test to actually
    // dispatch now, rather than waiting for its first `.then()`/`.end()` —
    // which otherwise would not happen until it's finally awaited below,
    // long after we need it to already be in flight.
    const vendorReq = Promise.resolve(post(vendor.vendorCookies, `vendor/orders/${vendorOrderId}/start-preparing`));
    await reached;
    const cancelRes = await cancel(customer, orderId);
    expect(cancelRes.status).toBe(201);
    release();
    const vendorRes = await vendorReq;

    // The write must have found nothing left to update: it lost the race.
    expect(vendorRes.status).toBe(409);
    const after = await ctx.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId } });
    expect(after.status).toBe('CANCELLED');
    expect(after.preparingAt).toBeNull();
  });

  it('markReady loses the race: the vendor-order stays CANCELLED and dispatch is not re-armed', async () => {
    const vendor = await makeVendor();
    const { customer, orderId, vendorOrderId } = await checkout(vendor);
    const prismaService = ctx.app.get(PrismaService);
    const { reached, release } = pauseVendorWrite(prismaService, vendorOrderId);

    const vendorReq = post(vendor.vendorCookies, `vendor/orders/${vendorOrderId}/ready`);
    await reached;
    const cancelRes = await cancel(customer, orderId);
    expect(cancelRes.status).toBe(201);
    release();
    const vendorRes = await vendorReq;

    expect(vendorRes.status).toBe(409);
    const after = await ctx.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId } });
    expect(after.status).toBe('CANCELLED');
    expect(after.readyForPickupAt).toBeNull();

    // Dispatch must not have been re-armed for a refunded order.
    const delivery = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { vendorOrderId } });
    expect(delivery.status).toBe('CANCELLED');
    expect(delivery.readyForDispatchAt).toBeNull();
    expect(delivery.offerCount).toBe(0);
    expect(delivery.assignedDriverProfileId).toBeNull();
  });
});
