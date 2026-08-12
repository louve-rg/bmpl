/**
 * Driver Earnings, Escrow Release & Vendor Settlement (Phase 3 · M18) — integration
 * vs real Postgres. Internal escrow distribution after fulfilment: vendor net,
 * driver earning, platform fees — one balanced, atomic, idempotent ledger
 * transaction via the sole WalletService path. Covers single + multi-vendor
 * settlement, exact balancing, global ledger net zero, idempotent replay,
 * delivery-not-complete + not-authorized rejection, ownership/permission
 * isolation, reconciliation, and the no-inventory/no-dispatch/no-payout invariants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function register(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

const acctBalance = async (accountId: string) => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};
const globalNet = async () => {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
};
const systemAcct = (type: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: type as never, userId: null, currency: 'BZD' } });
const userAcct = async (userId: string) => {
  return ctx.prisma.walletAccount.findFirst({ where: { userId, type: 'USER', currency: 'BZD' } });
};

/** Fund escrow with a balanced TOPUP_CLEARING → ESCROW transfer (simulates an
 *  authorized order's escrowed funds; keeps the global ledger at net zero). */
async function fundEscrow(amountMinor: number) {
  const escrow = await systemAcct('SYSTEM_ESCROW');
  const clearing = await systemAcct('SYSTEM_TOPUP_CLEARING');
  await ctx.prisma.walletTransaction.create({
    data: { type: 'TOPUP', status: 'POSTED', currency: 'BZD', reference: `test-escrow-fund-${uniq()}`, postedAt: new Date(), entries: { create: [{ accountId: escrow.id, direction: 'CREDIT', amountMinor: BigInt(amountMinor) }, { accountId: clearing.id, direction: 'DEBIT', amountMinor: BigInt(amountMinor) }] } },
  });
  await ctx.prisma.walletAccount.update({ where: { id: escrow.id }, data: { cachedBalanceMinor: { increment: BigInt(amountMinor) } } });
}

interface Settleable { vendorOrderId: string; vendorUserId: string; driverUserId: string; driverProfileId: string; orderId: string; customerId: string; customerCookies: string[]; productId: string; inventoryId: string; deliveryId: string }

/** Seed an AUTHORIZED, escrow-funded, DELIVERED single-vendor delivery order. */
async function seedDelivered(opts: { subtotal: number; deliveryFee: number; withDriver?: boolean } = { subtotal: 10000, deliveryFee: 500 }): Promise<Settleable> {
  const s = uniq();
  const withDriver = opts.withDriver ?? true;
  // vendor
  const vend = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: vend.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({ data: { userId: vend.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
  const product = await ctx.prisma.product.create({ data: { vendorProfileId: vp.id, categoryId, title: `P ${s}`, slug: `p-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: BigInt(opts.subtotal), currency: 'BZD', inventory: { create: { quantity: 10, reserved: 1 } } } });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  // driver
  let driverUserId = '', driverProfileId = '';
  if (withDriver) {
    const drv = await register(`drv_${s}@example.bz`);
    driverUserId = drv.userId;
    const dp = await ctx.prisma.driverProfile.create({ data: { userId: drv.userId, legalName: 'D', displayName: `Drv${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true } });
    driverProfileId = dp.id;
  }
  // customer + order graph
  const cust = await register(`cust_${s}@example.bz`);
  const num = `ORD-${s}`;
  const total = opts.subtotal + opts.deliveryFee;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num, userId: cust.userId, status: 'PENDING', itemCount: 1, subtotalMinor: BigInt(opts.subtotal), deliveryFeeMinor: BigInt(opts.deliveryFee), totalMinor: BigInt(total),
      addresses: { create: { type: 'SHIPPING', fullName: 'C', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE' } },
      vendorOrders: { create: { orderNumber: `${num}-1`, vendorProfileId: vp.id, status: 'PENDING', deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: BigInt(opts.subtotal), items: { create: { productId: product.id, productTitle: 'P', unitPriceMinor: BigInt(opts.subtotal), quantity: 1, subtotalMinor: BigInt(opts.subtotal) } }, delivery: { create: { status: 'DELIVERED', feeMinor: BigInt(opts.deliveryFee), deliveredAt: new Date(), ...(withDriver ? { assignedDriverProfileId: driverProfileId } : {}) } } } },
      payment: { create: { paymentNumber: `PAY-${s}`, userId: cust.userId, amountMinor: BigInt(total), currency: 'BZD', status: 'AUTHORIZED', authorizedAt: new Date() } },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  await fundEscrow(total);
  const vo = order.vendorOrders[0]!;
  return { vendorOrderId: vo.id, vendorUserId: vend.userId, driverUserId, driverProfileId, orderId: order.id, customerId: cust.userId, customerCookies: cust.cookies, productId: product.id, inventoryId: inv.id, deliveryId: vo.delivery!.id };
}
/** Settle via the admin path (mirrors the delivery-completion auto-trigger). */
const settle = (voId: string) => post(adminCookies, `admin/settlements/vendor-order/${voId}/retry`);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma); // seeds SYSTEM_ESCROW / SYSTEM_PLATFORM_FEES / SYSTEM_TOPUP_CLEARING
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
  categoryId = (await post(adminCookies, 'admin/categories', { name: `Cat ${uniq()}` })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('single-vendor settlement (balanced escrow release)', () => {
  it('splits escrow into vendor net, driver earning, and platform revenue with an exactly-balanced ledger', async () => {
    const o = await seedDelivered({ subtotal: 10000, deliveryFee: 500 });
    const escrowBefore = await acctBalance((await systemAcct('SYSTEM_ESCROW')).id);
    const res = await settle(o.vendorOrderId);
    expect(res.status).toBe(201);
    expect(res.body.settled).toBe(true);

    const settlement = await ctx.prisma.vendorSettlement.findUniqueOrThrow({ where: { vendorOrderId: o.vendorOrderId } });
    expect(settlement.status).toBe('POSTED');
    // default config: 10% commission of 10000 = 1000; 80% of 500 delivery = 400
    expect(Number(settlement.commissionMinor)).toBe(1000);
    expect(Number(settlement.driverAllocationMinor)).toBe(400);
    expect(Number(settlement.platformFeeMinor)).toBe(100); // 20% of delivery
    expect(Number(settlement.netMinor)).toBe(9000); // vendor net
    expect(Number(settlement.grossMinor)).toBe(10500);

    const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { orderDeliveryId: o.deliveryId } });
    expect(earning.status).toBe('POSTED');
    expect(Number(earning.netMinor)).toBe(400);

    // ledger movements
    expect(await acctBalance((await systemAcct('SYSTEM_ESCROW')).id)).toBe(escrowBefore - 10500n);
    expect(await acctBalance((await userAcct(o.vendorUserId))!.id)).toBe(9000n);
    expect(await acctBalance((await userAcct(o.driverUserId))!.id)).toBe(400n);
    expect(await acctBalance((await systemAcct('SYSTEM_PLATFORM_FEES')).id)).toBe(1100n); // commission 1000 + platform delivery 100
    expect(await globalNet()).toBe(0n); // global ledger nets to zero

    // payment settled (single-vendor order)
    expect((await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: o.orderId } })).status).toBe('SETTLED');
    // audit
    for (const action of ['SETTLEMENT_POSTED', 'ESCROW_RELEASED_SETTLEMENT', 'VENDOR_SETTLEMENT_POSTED', 'DRIVER_EARNING_POSTED', 'PLATFORM_FEE_POSTED'] as const) {
      expect(await ctx.prisma.auditLog.count({ where: { action } })).toBeGreaterThan(0);
    }
  });

  it('is idempotent — re-settling never double-releases escrow or double-credits', async () => {
    const o = await seedDelivered({ subtotal: 4000, deliveryFee: 200 });
    await settle(o.vendorOrderId).expect(201);
    const vendorBal = await acctBalance((await userAcct(o.vendorUserId))!.id);
    const escrowBal = await acctBalance((await systemAcct('SYSTEM_ESCROW')).id);
    // settle again (idempotent)
    const again = await settle(o.vendorOrderId);
    expect(again.body.settled).toBe(true);
    expect(await acctBalance((await userAcct(o.vendorUserId))!.id)).toBe(vendorBal); // unchanged
    expect(await acctBalance((await systemAcct('SYSTEM_ESCROW')).id)).toBe(escrowBal); // unchanged
    expect(await ctx.prisma.walletTransaction.count({ where: { reference: `settlement:${o.vendorOrderId}:v1` } })).toBe(1);
    expect(await ctx.prisma.vendorSettlement.count({ where: { vendorOrderId: o.vendorOrderId } })).toBe(1);
    expect(await globalNet()).toBe(0n);
  });

  it('does not mutate inventory or dispatch state', async () => {
    const o = await seedDelivered({ subtotal: 3000, deliveryFee: 300 });
    const invBefore = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: o.inventoryId } });
    const delBefore = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: o.deliveryId } });
    await settle(o.vendorOrderId).expect(201);
    const invAfter = await ctx.prisma.inventory.findUniqueOrThrow({ where: { id: o.inventoryId } });
    const delAfter = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: o.deliveryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reserved).toBe(invBefore.reserved);
    expect(delAfter.status).toBe(delBefore.status);
  });
});

describe('rejections + exceptions', () => {
  it('rejects settlement when the delivery is not complete (no ledger movement)', async () => {
    const o = await seedDelivered({ subtotal: 5000, deliveryFee: 400 });
    await ctx.prisma.orderDelivery.update({ where: { id: o.deliveryId }, data: { status: 'IN_TRANSIT' } });
    const before = await globalNet();
    const res = await settle(o.vendorOrderId);
    expect(res.body.settled).toBe(false);
    expect(res.body.reason).toMatch(/not complete/i);
    expect(await ctx.prisma.vendorSettlement.findUnique({ where: { vendorOrderId: o.vendorOrderId } })).toBeNull();
    expect(await globalNet()).toBe(before);
  });

  it('rejects settlement when the payment is not authorized', async () => {
    const o = await seedDelivered({ subtotal: 5000, deliveryFee: 400 });
    await ctx.prisma.payment.updateMany({ where: { orderId: o.orderId }, data: { status: 'PENDING' } });
    const res = await settle(o.vendorOrderId);
    expect(res.body.settled).toBe(false);
    expect(res.body.reason).toMatch(/not authorized/i);
  });
});

describe('multi-vendor independence', () => {
  it('settles one vendor-order without releasing another incomplete one', async () => {
    // Build a 2-vendor order manually: one delivered, one still in transit.
    const s = uniq();
    const cust = await register(`mv_cust_${s}@example.bz`);
    const mk = async (tag: string) => {
      const v = await register(`mv_${tag}_${s}@example.bz`);
      await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
      const vp = await ctx.prisma.vendorProfile.create({ data: { userId: v.userId, businessName: `MV${tag}${s}`, slug: `mv-${tag}-${s}`, contactEmail: `mv${tag}${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
      const drv = await register(`mv_drv_${tag}_${s}@example.bz`);
      const dp = await ctx.prisma.driverProfile.create({ data: { userId: drv.userId, legalName: 'D', displayName: `d${tag}${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL${tag}${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED' } });
      return { vpId: vp.id, vendorUserId: v.userId, driverProfileId: dp.id, driverUserId: drv.userId };
    };
    const a = await mk('a');
    const b = await mk('b');
    const num = `ORD-MV-${s}`;
    const order = await ctx.prisma.order.create({
      data: {
        orderNumber: num, userId: cust.userId, status: 'PENDING', itemCount: 2, subtotalMinor: 15000n, deliveryFeeMinor: 1000n, totalMinor: 16000n,
        addresses: { create: { type: 'SHIPPING', fullName: 'C', addressLine1: '1', city: 'BZ', district: 'BELIZE' } },
        payment: { create: { paymentNumber: `PAY-MV-${s}`, userId: cust.userId, amountMinor: 16000n, currency: 'BZD', status: 'AUTHORIZED', authorizedAt: new Date() } },
        vendorOrders: {
          create: [
            { orderNumber: `${num}-1`, vendorProfileId: a.vpId, status: 'PENDING', deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 10000n, delivery: { create: { status: 'DELIVERED', feeMinor: 500n, deliveredAt: new Date(), assignedDriverProfileId: a.driverProfileId } } },
            { orderNumber: `${num}-2`, vendorProfileId: b.vpId, status: 'PENDING', deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 5000n, delivery: { create: { status: 'IN_TRANSIT', feeMinor: 500n, assignedDriverProfileId: b.driverProfileId } } },
          ],
        },
      },
      include: { vendorOrders: { include: { delivery: true } } },
    });
    await fundEscrow(16000);
    const voA = order.vendorOrders.find((v) => v.subtotalMinor === 10000n)!;
    const voB = order.vendorOrders.find((v) => v.subtotalMinor === 5000n)!;

    // settle A only
    await settle(voA.id).expect(201);
    expect(await acctBalance((await userAcct(a.vendorUserId))!.id)).toBe(9000n);
    // B not settled (in transit) → B vendor gets nothing
    expect((await settle(voB.id)).body.settled).toBe(false);
    const bWallet = await userAcct(b.vendorUserId);
    expect(bWallet ? await acctBalance(bWallet.id) : 0n).toBe(0n);
    // payment is SETTLING (one of two settled), not SETTLED
    expect((await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('SETTLING');
    expect(await globalNet()).toBe(0n);
  });
});

describe('reads, permissions, reconciliation, fee config', () => {
  it('vendor sees own settlements; driver sees own earnings; isolation enforced', async () => {
    const o = await seedDelivered({ subtotal: 6000, deliveryFee: 300 });
    await settle(o.vendorOrderId).expect(201);
    const vendorUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.vendorUserId } });
    const vc = await login(vendorUser.email, 'CustomerPass123');
    const vlist = await get(vc, 'vendor/settlements');
    expect(vlist.status).toBe(200);
    expect(vlist.body.settlements.some((x: { vendorOrderId: string }) => x.vendorOrderId === o.vendorOrderId)).toBe(true);
    expect(vlist.body.totals.postedMinor).toBeGreaterThan(0);

    const driverUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.driverUserId } });
    await ctx.prisma.userRole.upsert({ where: { userId_roleCode: { userId: o.driverUserId, roleCode: 'DELIVERY_DRIVER' } }, create: { userId: o.driverUserId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() }, update: { status: 'APPROVED' } });
    const dc = await login(driverUser.email, 'CustomerPass123');
    const elist = await get(dc, 'driver/earnings');
    expect(elist.status).toBe(200);
    expect(elist.body.totals.postedMinor).toBe(240); // 80% of the 300 delivery fee

    // another vendor cannot read this vendor's settlement detail
    const other = await register(`other_${uniq()}@example.bz`);
    await ctx.prisma.userRole.create({ data: { userId: other.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vendorProfile.create({ data: { userId: other.userId, businessName: `Other${uniq()}`, slug: `other-${uniq()}`, contactEmail: 'o@x.bz', approvalStatus: 'APPROVED' } });
    const settlementId = vlist.body.settlements[0].id;
    expect((await get(other.cookies, `vendor/settlements/${settlementId}`)).status).toBe(404);
  });

  it('admin reconciliation reports a balanced ledger; fee config requires manage permission', async () => {
    const recon = await get(adminCookies, 'admin/settlements/reconciliation');
    expect(recon.status).toBe(200);
    expect(recon.body.balanced).toBe(true);
    expect(recon.body.globalLedgerNetMinor).toBe(0);

    // read fee config (settlements.read)
    const cfg = await get(adminCookies, 'admin/settlements/fee-config');
    expect(cfg.body.commissionBps).toBe(1000);
    // update requires settlements.manage
    const readOnly = await seedLimitedAdmin(ctx.prisma, `ro_${uniq()}@example.bz`, ['settlements.read']);
    const roCookies = await login(readOnly.email, readOnly.password);
    expect((await patch(roCookies, 'admin/settlements/fee-config', { commissionBps: 1500 })).status).toBe(403);
    expect((await patch(adminCookies, 'admin/settlements/fee-config', { commissionBps: 1500 })).status).toBe(200);
    // a customer cannot read admin settlements
    const cust = await register(`nc_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'admin/settlements')).status).toBe(403);
    // restore default for other tests
    await patch(adminCookies, 'admin/settlements/fee-config', { commissionBps: 1000 });
  });

  it('customer can read their own order settlement status', async () => {
    const o = await seedDelivered({ subtotal: 2000, deliveryFee: 100 });
    await settle(o.vendorOrderId).expect(201);
    const res = await get(o.customerCookies, `orders/${o.orderId}/settlement`);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('SETTLED');
    expect(res.body.vendorOrders[0].settlementStatus).toBe('POSTED');
  });
});
