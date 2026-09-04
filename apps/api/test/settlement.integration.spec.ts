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

const ADDRESS = {
  fullName: 'Settlement Customer', phone: '501-222-3333', addressLine1: '5 Barrack Road',
  city: 'Belize City', district: 'BELIZE', latitude: 17.4995, longitude: -88.1976,
};

/**
 * A vendor whose checkout numbers are the product's numbers: the product price
 * IS the subtotal and the store's base delivery fee IS the delivery fee, so
 * the totals every assertion checks come out of the pricing engine, not out of
 * a hand-typed order row. Profile creation itself is role/bootstrap machinery
 * (vendor onboarding is exercised by its own suite).
 */
async function makeVendor(s: string, priceMinor: number, deliveryFeeMinor: number) {
  const vend = await register(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: vend.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId: vend.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`,
      approvalStatus: 'APPROVED', storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: BigInt(deliveryFeeMinor) } },
      locations: { create: { label: 'Main', addressLine1: '12 Freetown Road', city: 'Belize City', district: 'BELIZE', latitude: 17.4995, longitude: -88.1976, isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id, categoryId, title: `P ${s}`, slug: `p-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED',
      priceMinor: BigInt(priceMinor), currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } },
    },
  });
  return { vendorUserId: vend.userId, vendorCookies: vend.cookies, vendorProfileId: vp.id, productId: product.id };
}

/** An approved, online, vehicled driver who can actually be assigned and drive the job. */
async function makeApprovedDriver(s: string) {
  const drv = await register(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: drv.userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  const dp = await ctx.prisma.driverProfile.create({
    data: { userId: drv.userId, legalName: 'D', displayName: `Drv${s}`, phone: '+501', homeDistrict: 'BELIZE', licenceNumber: `DL-${s}`, licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: { driverProfileId: dp.id, type: 'CAR', make: 'Toyota', model: 'Corolla', licencePlate: `SZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE, isActive: true, isPrimary: true, approvalStatus: 'APPROVED' },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: dp.id, district: 'BELIZE', isActive: true } });
  return { cookies: drv.cookies, driverUserId: drv.userId, driverProfileId: dp.id, vehicleId: vehicle.id };
}

/**
 * Drive one delivery through the product to the far edge of the driver flow:
 * admin manual assignment, then accept → pickup PIN → in-transit (→ arriving).
 * Every transition is the real endpoint; the PINs are read from the row the
 * way the driver reads them off the vendor's counter slip.
 */
async function driveTo(driver: { cookies: string[]; driverProfileId: string; vehicleId: string }, deliveryId: string, upTo: 'IN_TRANSIT' | 'ARRIVING') {
  const assigned = await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId });
  expect(assigned.status).toBe(201);
  expect((await post(driver.cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(201);
  const pins = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { pickupPin: true } });
  expect((await post(driver.cookies, `driver/jobs/${deliveryId}/confirm-pickup`, { pin: pins.pickupPin })).status).toBe(201);
  expect((await post(driver.cookies, `driver/jobs/${deliveryId}/in-transit`)).status).toBe(201);
  if (upTo === 'ARRIVING') expect((await post(driver.cookies, `driver/jobs/${deliveryId}/arriving`)).status).toBe(201);
}

/**
 * The product cannot produce a DELIVERED-but-unsettled delivery on purpose:
 * the driver's confirm-delivery endpoint settles synchronously in the same
 * request (driver-jobs.service, "delivery completion triggers internal
 * settlement"). In production that pristine state exists only when the
 * auto-settlement FAILS — which is exactly the state the admin retry endpoint
 * under test here exists to recover. This one raw write simulates that
 * failure honestly; taking the last step through the API instead would settle
 * the order inside the fixture and turn every assertion below into a no-op
 * replay against an already-settled ledger.
 */
async function markDeliveredUnsettled(deliveryId: string) {
  await ctx.prisma.orderDelivery.update({ where: { id: deliveryId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
}

interface Settleable { vendorOrderId: string; vendorUserId: string; driverUserId: string; driverProfileId: string; orderId: string; customerId: string; customerCookies: string[]; productId: string; inventoryId: string; deliveryId: string }

/**
 * An AUTHORIZED, escrow-funded, DELIVERED single-vendor delivery order that
 * the product actually made. The customer's wallet is funded by administrative
 * test credit (the sanctioned funding path, as the shipping suites use for
 * real-side orders); checkout builds the order graph, reserves stock and
 * AUTHORIZES payment — which is what funds escrow, with the customer's own
 * wallet money, through the wallet service; the driver is admin-assigned and
 * drives the job to ARRIVING over the driver API. Escrow is therefore never
 * fabricated: the fundEscrow fixture that used to post a raw TOPUP and
 * directly increment the escrow account's cached balance is gone — the real
 * authorization path produces the exact escrow state these tests need.
 * The final DELIVERED-unsettled step is simulated; see markDeliveredUnsettled.
 */
async function seedDelivered(opts: { subtotal: number; deliveryFee: number } = { subtotal: 10000, deliveryFee: 500 }): Promise<Settleable> {
  const s = uniq();
  const total = opts.subtotal + opts.deliveryFee;
  const vendor = await makeVendor(s, opts.subtotal, opts.deliveryFee);
  const driver = await makeApprovedDriver(s);

  const cust = await register(`cust_${s}@example.bz`);
  expect((await post(adminCookies, 'admin/wallet/test-credit', { userId: cust.userId, amountMinor: total, reason: 'Settlement fixture funding.' })).status).toBe(201);
  expect((await post(cust.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 })).status).toBeLessThan(400);
  const co = await post(cust.cookies, 'checkout', { vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }], deliveryAddress: ADDRESS, payWithWallet: true });
  expect(co.status).toBe(201);

  const order = await ctx.prisma.order.findFirstOrThrow({ where: { userId: cust.userId }, orderBy: { createdAt: 'desc' } });
  const vo = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: order.id }, include: { delivery: true } });
  const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: vendor.productId } });
  // The product must have produced exactly the numbers the assertions rely on.
  // If any of these ever fail, that is a finding about checkout or pricing —
  // not a reason to adjust what the settlement tests expect.
  expect(Number(order.subtotalMinor)).toBe(opts.subtotal);
  expect(Number(vo.delivery!.feeMinor)).toBe(opts.deliveryFee);
  expect(Number(payment.amountMinor)).toBe(total);
  expect(payment.status).toBe('AUTHORIZED');

  // The vendor packs and readies the order before anyone is sent to collect it
  // — the product's own sequence. (Automatic dispatch is off by default in a
  // fresh database, so the manual assignment below stays deterministic.)
  expect((await post(vendor.vendorCookies, `vendor/orders/${vo.id}/ready`)).status).toBe(201);

  await driveTo(driver, vo.delivery!.id, 'ARRIVING');
  await markDeliveredUnsettled(vo.delivery!.id);

  return { vendorOrderId: vo.id, vendorUserId: vendor.vendorUserId, driverUserId: driver.driverUserId, driverProfileId: driver.driverProfileId, orderId: order.id, customerId: cust.userId, customerCookies: cust.cookies, productId: vendor.productId, inventoryId: inv.id, deliveryId: vo.delivery!.id };
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
    // A real 2-vendor checkout: ONE payment authorizes 16000 into escrow with
    // the customer's own money, split across two vendor-orders. Vendor A's
    // delivery is driven to ARRIVING through the driver API and then marked
    // delivered-unsettled (see markDeliveredUnsettled); vendor B's is driven
    // to IN_TRANSIT and simply STOPS there — a genuinely product-made
    // incomplete delivery, no fabrication at all on that side.
    const s = uniq();
    const a = { ...(await makeVendor(`mva${s}`, 10000, 500)), ...(await makeApprovedDriver(`mva${s}`)) };
    const b = { ...(await makeVendor(`mvb${s}`, 5000, 500)), ...(await makeApprovedDriver(`mvb${s}`)) };

    const cust = await register(`mv_cust_${s}@example.bz`);
    expect((await post(adminCookies, 'admin/wallet/test-credit', { userId: cust.userId, amountMinor: 16000, reason: 'Multi-vendor settlement fixture.' })).status).toBe(201);
    expect((await post(cust.cookies, 'cart/items', { productId: a.productId, quantity: 1 })).status).toBeLessThan(400);
    expect((await post(cust.cookies, 'cart/items', { productId: b.productId, quantity: 1 })).status).toBeLessThan(400);
    const co = await post(cust.cookies, 'checkout', {
      vendors: [
        { vendorProfileId: a.vendorProfileId, deliveryMethod: 'DELIVERY' },
        { vendorProfileId: b.vendorProfileId, deliveryMethod: 'DELIVERY' },
      ],
      deliveryAddress: ADDRESS,
      payWithWallet: true,
    });
    expect(co.status).toBe(201);

    const order = await ctx.prisma.order.findFirstOrThrow({ where: { userId: cust.userId }, orderBy: { createdAt: 'desc' } });
    // One authorization for the whole order — the product's number, checked.
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(Number(payment.amountMinor)).toBe(16000);
    expect(payment.status).toBe('AUTHORIZED');

    const voA = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: order.id, vendorProfileId: a.vendorProfileId }, include: { delivery: true } });
    const voB = await ctx.prisma.vendorOrder.findFirstOrThrow({ where: { orderId: order.id, vendorProfileId: b.vendorProfileId }, include: { delivery: true } });

    expect((await post(a.vendorCookies, `vendor/orders/${voA.id}/ready`)).status).toBe(201);
    expect((await post(b.vendorCookies, `vendor/orders/${voB.id}/ready`)).status).toBe(201);
    await driveTo(a, voA.delivery!.id, 'ARRIVING');
    await markDeliveredUnsettled(voA.delivery!.id);
    await driveTo(b, voB.delivery!.id, 'IN_TRANSIT');

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
