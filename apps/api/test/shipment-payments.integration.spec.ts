/**
 * The money side of shipping.
 *
 * Shipping used to have a quote and no payment at all: it created a shipment,
 * moved nothing, and sent a driver anyway. These are the invariants that make
 * the new payment path safe to leave running unattended — the ones where being
 * wrong means somebody is charged twice, or a driver is sent for a parcel
 * nobody paid for, or money is stranded in escrow with nothing to release it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** Belize City to Belize City: one courier, no terminal, priced locally. */
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

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'Shipment payment tests.' });
  expect(r.status).toBe(201);
}

/**
 * The platform-wide price of a local courier run, set the way operations sets
 * it (audit finding H1: the raw platformSetting write this replaces never
 * proved the console path worked). Both rates: a real customer is priced by
 * the first, a designated test account by the second, and this suite
 * exercises both kinds of customer.
 */
async function setLocalCourierFee(feeMinor: bigint) {
  const r = await request(ctx.server)
    .patch('/api/admin/ops/settings')
    .set('Cookie', admin)
    .send({ localCourierFeeMinor: Number(feeMinor), localCourierFeeTestMinor: Number(feeMinor), localCourierMinutes: 60 });
  expect(r.status).toBe(200);
}

const PRICE = 1500; // BZ$15.00

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  // Escrow is a shared system account, so its balance accumulates across tests
  // unless the ledger is cleared between them.
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await setLocalCourierFee(BigInt(PRICE));
  // Automatic dispatch on, so that when a leg is NOT offered it is because of
  // the payment rule rather than because dispatch was switched off.
  const settings = await ctx.prisma.platformSetting.findFirst({ orderBy: { createdAt: 'asc' } });
  if (settings) await ctx.prisma.platformSetting.update({ where: { id: settings.id }, data: { dispatchAutomatic: true } });

  const c = await registerCustomer(`shippay_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
});

const holdsFor = (paymentId: string) => ctx.prisma.walletHold.findMany({ where: { paymentId } });
const balanceOf = async (userId: string) => (await get(customer, 'wallet')).body as { availableMinor: number; onHoldMinor: number; totalMinor: number };

/* ------------------------------------------------------------------------- */

describe('asking the price', () => {
  it('moves no money and creates nothing', async () => {
    await fund(customerId, 10_000);
    const before = await balanceOf(customerId);

    const q = await post(customer, 'shipping/quote', localParcel());
    expect(q.status).toBe(201);
    expect(q.body.available).toBe(true);
    expect(q.body.totalMinor).toBe(PRICE);

    expect(await ctx.prisma.shipment.count()).toBe(0);
    expect(await ctx.prisma.payment.count()).toBe(0);
    expect(await ctx.prisma.walletHold.count()).toBe(0);
    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(before.availableMinor);
  });
});

describe('paying for a shipment', () => {
  it('creates exactly one payment and one hold, for exactly the quoted price', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(201);

    const payments = await ctx.prisma.payment.findMany({ where: { shipmentId: r.body.id } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]!.amountMinor)).toBe(PRICE);
    expect(payments[0]!.status).toBe('AUTHORIZED');
    // The CHECK constraint's promise, asserted: a shipment payment is not also
    // an order payment.
    expect(payments[0]!.orderId).toBeNull();

    const holds = await holdsFor(payments[0]!.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.status).toBe('AUTHORIZED');
    expect(Number(holds[0]!.amountMinor)).toBe(PRICE);
  });

  it('is traceable from the shipment to the ledger and back', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id }, include: { ledgerRefs: true, holds: true } });
    expect(payment.ledgerRefs.length).toBeGreaterThan(0);
    expect(payment.ledgerRefs.every((l) => l.status === 'POSTED')).toBe(true);

    // ...and back the other way.
    const back = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: payment.shipmentId! }, include: { payment: true } });
    expect(back.payment!.id).toBe(payment.id);
  });

  it('moves the money out of the customer wallet and into escrow', async () => {
    await fund(customerId, 10_000);
    await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });

    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(10_000 - PRICE);

    const escrow = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_ESCROW' } });
    const entries = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: escrow.id } });
    const net = entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(Number(net)).toBe(PRICE);
  });

  it('confirms the shipment and makes the courier leg workable', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });

    const legs = await ctx.prisma.shipmentLeg.findMany({ where: { shipmentId: r.body.id } });
    expect(legs).toHaveLength(1);
    expect(legs[0]!.kind).toBe('DIRECT');
    expect(legs[0]!.status).toBe('READY');
  });
});

describe('when the customer cannot afford it', () => {
  it('creates no shipment, no payment and no hold', async () => {
    await fund(customerId, 500); // BZ$5.00 against a BZ$15.00 parcel

    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/insufficient/i);

    expect(await ctx.prisma.shipment.count()).toBe(0);
    expect(await ctx.prisma.payment.count()).toBe(0);
    expect(await ctx.prisma.walletHold.count()).toBe(0);
    expect(await ctx.prisma.shipmentLeg.count()).toBe(0);
  });

  it('leaves the balance exactly as it was', async () => {
    await fund(customerId, 500);
    const before = await balanceOf(customerId);
    await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(before.availableMinor);
    expect(after.onHoldMinor).toBe(0);
  });

  it('succeeds once there is enough money', async () => {
    await fund(customerId, 500);
    expect((await post(customer, 'shipping', { ...localParcel(), payWithWallet: true })).status).toBe(409);
    await fund(customerId, 10_000);
    expect((await post(customer, 'shipping', { ...localParcel(), payWithWallet: true })).status).toBe(201);
  });
});

describe('paying twice', () => {
  it('two identical bookings are two shipments, each charged once', async () => {
    // Distinct bookings are not duplicates — a customer may genuinely send two
    // identical parcels. What must never happen is one parcel charged twice.
    await fund(customerId, 10_000);
    const a = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const b = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);

    for (const id of [a.body.id, b.body.id]) {
      expect(await ctx.prisma.payment.count({ where: { shipmentId: id } })).toBe(1);
    }
    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(10_000 - PRICE * 2);
  });

  it('one shipment can never carry two payments', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const existing = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    // The unique index is the guarantee, so prove it at the database.
    await expect(
      ctx.prisma.payment.create({
        data: {
          paymentNumber: `DUP-${uniq()}`,
          shipmentId: r.body.id,
          userId: customerId,
          amountMinor: BigInt(PRICE),
          currency: 'BZD',
          status: 'CREATED',
          methodType: 'WALLET',
        },
      }),
    ).rejects.toThrow();

    expect(await ctx.prisma.payment.count({ where: { shipmentId: r.body.id } })).toBe(1);
    expect(existing.status).toBe('AUTHORIZED');
  });

  it('concurrent bookings never overspend the wallet', async () => {
    // Enough for two parcels, four requests at once. The ledger check runs
    // inside each transaction, so at most two can win.
    await fund(customerId, PRICE * 2);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(customer, 'shipping', { ...localParcel(), payWithWallet: true })),
    );
    const created = results.filter((r) => r.status === 201);
    expect(created.length).toBeLessThanOrEqual(2);

    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(PRICE * 2 - created.length * PRICE);
    expect(after.availableMinor).toBeGreaterThanOrEqual(0);

    // Whatever happened, the ledger nets to zero.
    const all = await ctx.prisma.walletLedgerEntry.findMany();
    const net = all.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
  });
});

describe('a shipment nobody paid for', () => {
  it('is never dispatched', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: false });
    expect(r.status).toBe(201);

    const legs = await ctx.prisma.shipmentLeg.findMany({ where: { shipmentId: r.body.id } });
    // Not workable, so neither the booking call nor the sweeper can offer it.
    expect(legs.every((l) => l.status === 'PENDING')).toBe(true);
    expect(legs.every((l) => l.courierStatus === null)).toBe(true);
    expect(await ctx.prisma.payment.count({ where: { shipmentId: r.body.id } })).toBe(0);
  });

  it('is refused by dispatch even if a leg is made READY by hand', async () => {
    // The leg status is data a future caller could set. The rule has to hold
    // independently of it.
    const { ShipmentDispatchService } = await import('../src/shipping/shipment-dispatch.service');
    const dispatch = ctx.app.get(ShipmentDispatchService);

    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: false });
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    await ctx.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { status: 'READY' } });

    const outcome = (await dispatch.dispatchLeg(leg.id)) as { result: string; reason?: string };
    expect(outcome.result).toBe('SKIPPED');
    expect(outcome.reason).toMatch(/not been paid/i);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(after.assignedDriverProfileId).toBeNull();
  });
});

describe('cancelling before anybody has done any work', () => {
  it('releases the hold exactly once and gives the money back', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    const cancel = await post(customer, `shipping/${r.body.id}/cancel`, { reason: 'Changed my mind.' });
    expect(cancel.status).toBe(201);

    const holds = await holdsFor(payment.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.status).toBe('RELEASED');

    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(10_000);
    expect(after.onHoldMinor).toBe(0);

    // Cancelling again must not refund a second time.
    await post(customer, `shipping/${r.body.id}/cancel`, { reason: 'again' });
    const again = await balanceOf(customerId);
    expect(again.availableMinor).toBe(10_000);

    const refunds = await ctx.prisma.walletTransaction.count({ where: { type: 'REFUND' } });
    expect(refunds).toBeLessThanOrEqual(1);
  });
});

describe('cancelling after delivery (BMPL-300)', () => {
  /**
   * Books a local DIRECT parcel, then drives its single leg all the way
   * through the real staff machinery (start -> handoff) so the shipment
   * reaches DELIVERED exactly the way production does — and
   * settleShipment() fires for real, the same way it fires in production.
   *
   * The PIN is read straight from the database rather than through
   * GET .../handoff-pin: that endpoint deliberately refuses to reveal a
   * DIRECT/LAST_MILE leg's code to staff at all (it belongs to the
   * recipient, not a desk) — same pattern as carrier-org-access's own
   * `pinOf` helper.
   */
  async function deliverDirectShipment() {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    expect((await post(admin, `admin/logistics/legs/${leg.id}/start`)).status).toBe(201);
    const { handoffPin } = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { handoffPin: true } });
    const handoff = await post(admin, `admin/logistics/legs/${leg.id}/handoff`, {
      pin: handoffPin,
      receivedByName: 'Recipient Sentinelname',
    });
    expect(handoff.status).toBe(201);
    return r.body.id as string;
  }

  it('refuses a customer cancelling a shipment that already delivered and settled — the money stays where it was paid out', async () => {
    const shipmentId = await deliverDirectShipment();
    const settled = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { payment: true } });
    expect(settled.status).toBe('DELIVERED');
    expect(settled.payment!.status).toBe('SETTLED');

    const cancel = await post(customer, `shipping/${shipmentId}/cancel`, { reason: 'Too late now.' });
    expect(cancel.status).toBe(400);

    // The record was NOT falsified: still DELIVERED, still SETTLED, never cancelled.
    const after = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { payment: true } });
    expect(after.status).toBe('DELIVERED');
    expect(after.cancelledAt).toBeNull();
    expect(after.payment!.status).toBe('SETTLED');
  });

  it('refuses a STAFF cancellation of the same delivered, settled shipment — nothing about being staff makes it correct to relabel it', async () => {
    const shipmentId = await deliverDirectShipment();

    const cancel = await request(ctx.server)
      .post(`/api/admin/logistics/shipments/${shipmentId}/cancel`)
      .set('Cookie', admin)
      .send({ reason: 'Ops trying to undo a delivered shipment.' });
    expect(cancel.status).toBe(400);

    const after = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(after.status).toBe('DELIVERED');
    expect(after.cancelledAt).toBeNull();
  });

  it('does not touch a shipment that has not delivered yet — the pre-custody cancellation path this guard must not break', async () => {
    // Same booking, but the leg is left exactly as booking leaves it: READY,
    // nobody has started it. This is the path real customers rely on, and it
    // must keep working exactly as the existing "cancelling before anybody
    // has done any work" describe block above already proves in detail.
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    expect(leg.status).toBe('READY');

    const cancel = await post(customer, `shipping/${r.body.id}/cancel`, { reason: 'Changed my mind before it moved.' });
    expect(cancel.status).toBe(201);

    const after = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledAt).not.toBeNull();
  });
});

describe('cancelling after custody has actually transferred (BMPL-183 — owner rule)', () => {
  /**
   * "Acceptance is not pickup; cancellation before actual custody does not
   * incur the delivery fee" — given by the owner, not derived. The other
   * half follows from it without needing to be stated separately: ONCE
   * custody has genuinely transferred, the fee already earned is not
   * refunded. A courier merely accepting the job writes no custody row and
   * leaves the leg READY, so that alone still refunds in full — proven
   * already, in detail, by "cancelling before anybody has done any work"
   * above. This block proves the other side: a real transfer (`startLeg`)
   * stops the refund.
   */
  it('does not refund the fee once a driver has actually taken the parcel, even though the shipment can still be stopped', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    // A real custody transfer, not merely an accepted offer — the driver
    // now actually holds the parcel.
    expect((await post(admin, `admin/logistics/legs/${leg.id}/start`)).status).toBe(201);
    expect(
      await ctx.prisma.custodyEvent.count({ where: { shipmentId: r.body.id, fromHolder: { not: null } } }),
    ).toBe(1);

    // The existing "already moving" guard still applies to self-service —
    // this card does not touch who may cancel, only what it costs.
    const selfCancel = await post(customer, `shipping/${r.body.id}/cancel`, { reason: 'Trying anyway.' });
    expect(selfCancel.status).toBe(400);

    // Staff can still stop it — but the fee already earned is not given back.
    const cancel = await request(ctx.server)
      .post(`/api/admin/logistics/shipments/${r.body.id}/cancel`)
      .set('Cookie', admin)
      .send({ reason: 'Recipient unreachable; stopping the run.' });
    expect(cancel.status).toBe(201);

    const holds = await holdsFor(payment.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.status).toBe('AUTHORIZED'); // never released

    const after = await balanceOf(customerId);
    expect(after.onHoldMinor).toBe(PRICE); // the fee is still held, not refunded

    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(shipment.status).toBe('CANCELLED');
    expect(shipment.cancelledAt).not.toBeNull();

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'SHIPMENT_CANCELLED', newValue: { path: ['shipmentId'], equals: r.body.id } },
    });
    expect((audit.newValue as { custodyTransferred: boolean }).custodyTransferred).toBe(true);
  });
});

describe('test money stays test money', () => {
  it('a shipment paid with test credit posts test-marked ledger movements', async () => {
    await post(admin, 'admin/users/test-flag', { userId: customerId, isTest: true, reason: 'Isolation test.' });
    await post(customer, 'wallet/top-up', { amountMinor: 10_000 });

    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(r.status).toBe(201);

    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(shipment.isTest).toBe(true);

    const escrowTxn = await ctx.prisma.walletTransaction.findFirstOrThrow({ where: { type: 'ESCROW_HOLD' }, orderBy: { createdAt: 'desc' } });
    expect(escrowTxn.isTest).toBe(true);
  });

  it('a real shipment is never offered to a test-only driver', async () => {
    // Asserted from the data rather than from a driver's screen: the dispatch
    // pool is filtered on the same boundary in both directions.
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(shipment.isTest).toBe(false);

    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    if (leg.assignedDriverProfileId) {
      const driver = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: leg.assignedDriverProfileId } });
      expect(driver.isTest).toBe(false);
    }
  });
});
