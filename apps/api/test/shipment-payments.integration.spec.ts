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
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

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

    // The regression guard for SHIPPING-E2E's two raw-500 fixes. Before
    // PaymentsService.ensureWalletPaymentMethod existed, this customer's
    // FIRST EVER wallet-paid booking meant whichever requests lost the
    // PaymentMethod upsert race inside the booking transaction got an
    // unmapped 500. Fixing that alone would have swapped it for the SECOND
    // raw 500 below (the wallet-row deadlock) the instant all four requests
    // reached escrowInTx's FOR UPDATE together instead of three dying early
    // — so this one test guards both mechanisms behind the one customer-
    // visible failure. This test passed with either raw 500 present anyway,
    // because it only ever checked `created.length`, never what the losers'
    // own responses actually were. Every non-201 response here must be the
    // SAME expected conflict a losing request should get on insufficient
    // funds, never anything else.
    for (const r of results) {
      if (r.status === 201) continue;
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).toMatch(/insufficient wallet balance/i);
    }

    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(PRICE * 2 - created.length * PRICE);
    expect(after.availableMinor).toBeGreaterThanOrEqual(0);

    // Whatever happened, the ledger nets to zero.
    const all = await ctx.prisma.walletLedgerEntry.findMany();
    const net = all.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
  });

  /**
   * SHIPPING-E2E — isolates the fix from the insufficient-balance path
   * above: fund enough for all four, so a loss can ONLY come from the
   * PaymentMethod-upsert race on this customer's first-ever wallet booking,
   * never from the wallet ledger check. Before
   * PaymentsService.ensureWalletPaymentMethod, this reproduced the raw 500
   * directly — every concurrent request here must now succeed.
   */
  it('a concurrent first-ever wallet booking never surfaces the PaymentMethod race as a raw 500', async () => {
    await fund(customerId, PRICE * 4);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(customer, 'shipping', { ...localParcel(), payWithWallet: true })),
    );
    for (const r of results) expect(r.status).toBe(201);

    expect(await ctx.prisma.payment.count({ where: { userId: customerId } })).toBe(4);
    expect(await ctx.prisma.paymentMethod.count({ where: { userId: customerId, type: 'WALLET' } })).toBe(1);
    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(0);
  });

  /**
   * SHIPPING-E2E — the SECOND mechanism, isolated on its own: a REPEAT
   * customer (one ordinary booking first, so the WALLET PaymentMethod row
   * already exists and the upsert race above never fires at all) whose
   * concurrent bookings used to deadlock Postgres directly at escrowInTx's
   * `FOR UPDATE` — confirmed LIVE on unmodified `main`, with zero PaymentMethod
   * involvement in the failure, before `PaymentsService.lockWalletForOrigination`
   * existed. This is the MAJORITY-case scenario (every customer after their
   * first wallet-paid booking), not an edge case.
   */
  it("a repeat customer's concurrent bookings never deadlock the wallet row", async () => {
    await fund(customerId, PRICE * 10);
    const first = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    expect(first.status).toBe(201); // establishes the PaymentMethod row -- now a "repeat" customer

    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(customer, 'shipping', { ...localParcel(), payWithWallet: true })),
    );
    for (const r of results) expect(r.status).toBe(201);

    expect(await ctx.prisma.payment.count({ where: { userId: customerId } })).toBe(5); // the first booking + 4 more
    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(PRICE * 10 - PRICE * 5);
  });

  /**
   * SHIPPING-E2E — guards the margin the deadlock fix above depends on, not
   * concurrency itself. `lockWalletForOrigination` holds the wallet row's
   * EXCLUSIVE lock across the WHOLE booking transaction, so N concurrent
   * bookings on one wallet now run end to end, one at a time, each still
   * bound by Prisma's 5000ms default interactive-transaction timeout. A
   * booking that gets slower multiplies straight into that serialized total
   * — at ~200ms/booking there is room for ~25 queued bookings before 5000ms;
   * at 600ms there is room for ~8. 600ms is the threshold that keeps 8
   * concurrent bookings safe, with ~3x headroom over the measured 196ms on a
   * quiet path (SHIPPING-E2E PR #547), loose enough not to flake on a loaded
   * CI runner.
   *
   * Deliberately asserts ONE booking's wall-clock time, not a concurrent
   * total: a concurrent-total assertion measures the test runner's own
   * contention as much as this code, which is the flakiest possible shape
   * for a CI timing test — and a flaky timing test gets its threshold raised
   * until it asserts nothing. If this ever fails, it means a booking step
   * got slower and ate into the deadlock fix's safety margin — report it,
   * do not raise the threshold.
   */
  it('a single wallet-paid booking stays well under the serialized-booking timeout budget', async () => {
    await fund(customerId, PRICE * 2);
    const t0 = Date.now();
    const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
    const elapsedMs = Date.now() - t0;
    expect(r.status).toBe(201);
    expect(elapsedMs).toBeLessThan(600);
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

/**
 * SHIP-CANCEL-AT-ORIGIN-HUB-INCONSISTENT.
 *
 * Every custody-transferred stage already refuses a self-service cancel
 * (proven above) — except one. The up-front "already moving" guard used to
 * be computed from per-leg STATUS ("is any leg IN_PROGRESS right now"),
 * which reads false in the gap between two legs: the first already
 * COMPLETED and handed off to a hub, the next not yet started. A shipment
 * sitting AT_ORIGIN_HUB is exactly that gap — custody plainly already left
 * the sender (the FIRST_MILE leg's own handoff wrote the custody row), but
 * no leg reads IN_PROGRESS, so the old guard let the cancel through with no
 * refund to match: the held fee was simply orphaned. god's ruling: refuse,
 * with the same message every other custody-transferred stage already
 * gives — applying the existing BMPL-183 rule, not inventing a refund path.
 */
describe('cancelling at a custody gap between two legs (SHIP-CANCEL-AT-ORIGIN-HUB-INCONSISTENT)', () => {
  const hub: Record<string, string> = {};

  beforeAll(async () => {
    for (const h of [
      { code: 'CGPO', name: 'Cancel-Gap Origin Hub', district: 'BELIZE', city: 'Belize City', fee: 1000 },
      { code: 'CGPD', name: 'Cancel-Gap Dest Hub', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
    ]) {
      const r = await post(admin, 'admin/logistics/hubs', {
        code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
        courierFeeMinor: h.fee,
      });
      expect(r.status).toBe(201);
      hub[h.code] = r.body.id;
    }
    expect(
      (
        await post(admin, 'admin/logistics/routes', {
          originHubId: hub.CGPO, destinationHubId: hub.CGPD, mode: 'AIR',
          durationMinutes: 45, priceMinor: 8000, carrierName: 'Tropic Air',
        })
      ).status,
    ).toBe(201);
  });

  const doorToHub = () => ({
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
    destination: { hubId: hub.CGPD, name: 'Recipient', phone: '501-444-5555' },
    preferredMode: 'AIR',
    description: 'One box',
    payWithWallet: true,
  });

  /** Books, then admin-drives only the FIRST_MILE leg to its own handoff —
   *  no driver needed (startLeg/handoff both work unassigned, same as
   *  `deliverDirectShipment` above) — and stops there, in the AT_ORIGIN_HUB
   *  gap, never touching the LINE_HAUL leg at all. */
  async function bookToOriginHubGap() {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', doorToHub());
    expect(r.status).toBe(201);
    const first = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id, kind: 'FIRST_MILE' } });
    expect((await post(admin, `admin/logistics/legs/${first.id}/start`, {})).status).toBe(201);
    const { handoffPin } = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id }, select: { handoffPin: true } });
    expect(
      (await post(admin, `admin/logistics/legs/${first.id}/handoff`, { pin: handoffPin, receivedByName: 'Counter staff' })).status,
    ).toBe(201);
    return { shipmentId: r.body.id as string, payment: await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } }) };
  }

  it('refuses a self-service cancel once the shipment sits AT_ORIGIN_HUB — the gap where custody already left the sender but no leg reads IN_PROGRESS — wallet is UNCHANGED on both available and hold', async () => {
    const { shipmentId, payment } = await bookToOriginHubGap();
    const atGap = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(atGap.status).toBe('AT_ORIGIN_HUB');

    const before = await balanceOf(customerId);

    const cancel = await post(customer, `shipping/${shipmentId}/cancel`, { reason: 'Trying to stop it.' });
    expect(cancel.status).toBe(400);
    expect(cancel.body.message).toMatch(/already moving/i);

    const after = await balanceOf(customerId);
    expect(after.availableMinor).toBe(before.availableMinor);
    expect(after.onHoldMinor).toBe(before.onHoldMinor);

    const holds = await holdsFor(payment.id);
    expect(holds[0]!.status).toBe('AUTHORIZED'); // never released — nothing moved

    const unchanged = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(unchanged.status).toBe('AT_ORIGIN_HUB');
    expect(unchanged.cancelledAt).toBeNull();
  });

  it('control: a cancel at AWAITING_PICKUP (before anything moved) still succeeds and still releases the hold — this must not become a blanket refusal', async () => {
    await fund(customerId, 10_000);
    const r = await post(customer, 'shipping', doorToHub());
    expect(r.status).toBe(201);
    const booked = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(booked.status).toBe('AWAITING_PICKUP');

    const cancel = await post(customer, `shipping/${r.body.id}/cancel`, { reason: 'Changed my mind before it moved.' });
    expect(cancel.status).toBe(201);

    const after = await balanceOf(customerId);
    expect(after.onHoldMinor).toBe(0);
    expect(after.availableMinor).toBe(10_000);

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    const holds = await holdsFor(payment.id);
    expect(holds[0]!.status).toBe('RELEASED');

    const cancelled = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(cancelled.status).toBe('CANCELLED');
  });

  /**
   * Same wrong-cause family #880 fixed, filed as its own LOW card: the
   * cancel refusal for AWAITING_COLLECTION reused DELIVERED's "already been
   * delivered" wording — false here. The parcel is sitting at a hub,
   * custody with BML, waiting for the recipient to walk in; nobody has
   * delivered anything. Text-only fix; the refusal itself (and the fact
   * that both statuses are terminal/settled — `isDelivered`'s own job) is
   * unchanged.
   */
  it('refuses a cancel at AWAITING_COLLECTION with text that matches what actually happened, not DELIVERED\'s wording', async () => {
    const booked = await bookToOriginHubGap();
    const lineHaul = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: booked.shipmentId, kind: 'LINE_HAUL' } });
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`, {})).status).toBe(201);
    const { handoffPin } = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id }, select: { handoffPin: true } });
    const handoff = await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: handoffPin, receivedByName: 'Counter staff' });
    expect(handoff.status).toBe(201);
    expect(handoff.body.status).toBe('AWAITING_COLLECTION');

    const cancel = await post(customer, `shipping/${booked.shipmentId}/cancel`, { reason: 'Trying to stop it.' });
    expect(cancel.status).toBe(400);
    expect(cancel.body.message).toMatch(/ready for the recipient to collect/i);
    expect(cancel.body.message).not.toMatch(/already been delivered/i);

    const unchanged = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.shipmentId } });
    expect(unchanged.status).toBe('AWAITING_COLLECTION');
    expect(unchanged.cancelledAt).toBeNull();
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
