/**
 * BMPL-378/BMPL-375 — the sink-level ownership guard, driven DIRECTLY.
 *
 * BMPL-376 proved staff action alone could charge a customer through
 * returnToSender/rerouteShipment. BMPL-375 fixed it structurally: those two
 * methods no longer reach escrowInTx at all (they only write a
 * ShipmentRoutingProposal now; only confirmRouting, gated on the shipment's
 * own customerUserId, may actually charge). Running BMPL-376's own test
 * suite with escrowInTx's ownership guard disabled proved that fact — all
 * four tests stayed green, because they no longer exercise that guard
 * through the HTTP surface at all (reported to god as the mutation-check
 * result; see that report for the trace).
 *
 * That is exactly why this file exists: the ownership guard
 * (`payment.userId !== actor.userId` in escrowInTx) is defense-in-depth for
 * every OTHER caller — orders.service.ts's checkout() reaches the same sink
 * directly, and so would any future caller nobody has written yet (BMPL-378's
 * own finding). Nothing in BMPL-376's suite can prove that guard exists,
 * because nothing in it calls the sink directly. This file drives
 * escrowInTx itself, bypassing returnToSender/rerouteShipment/checkout
 * entirely, with a deliberately mismatched authorizing party.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ForbiddenException } from '@nestjs/common';
import { PaymentsService } from '../src/payments/payments.service';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let payments: PaymentsService;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** The ordinary local courier config — no hub network needed for this file,
 *  only a real Shipment row to hang a Payment off (shipmentId is a real FK). */
async function setLocalCourierFee(feeMinor: bigint) {
  const r = await request(ctx.server)
    .patch('/api/admin/ops/settings')
    .set('Cookie', admin)
    .send({ localCourierFeeMinor: Number(feeMinor), localCourierFeeTestMinor: Number(feeMinor), localCourierMinutes: 60 });
  expect(r.status).toBe(200);
}

const localParcel = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
  destination: { district: 'BELIZE', city: 'Belize City', address: '18 Newtown Barracks', name: 'Recipient', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

/** Books a REAL shipment with payWithWallet:false — create() creates no
 *  Payment row at all in that branch, leaving a clean shipment to attach a
 *  fresh, hand-built Payment to via createForShipment. */
async function bookUnpaidShipment(customer: string[]) {
  const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: false });
  expect(r.status).toBe(201);
  return r.body as { id: string; reference: string };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  payments = ctx.app.get(PaymentsService);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await setLocalCourierFee(1500n);
});

describe('BMPL-378: escrowInTx itself refuses a mismatched authorizing party, driven directly — not through returnToSender, rerouteShipment, or checkout', () => {
  it('refuses to authorize a payment for an actor who is not its owner, moving nothing', async () => {
    const customer = await registerUser(`sink_owner_${uniq()}@example.com`);
    const outsider = await registerUser(`sink_outsider_${uniq()}@example.com`);
    await post(admin, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 50_000, reason: 'BMPL-378 sink test.' });

    const shipment = await bookUnpaidShipment(customer.cookies);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    const before = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    // Baseline taken here, not assumed zero: admin/wallet/test-credit above
    // already posted a real, legitimate funding entry against this same
    // wallet — this isolates entries NEW since that point, the same fix
    // already applied once on BMPL-376's own suite.
    const entriesBefore = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: wallet.id } });

    // Built the same way shipment.service.ts's own create() builds it —
    // createForShipment itself is not the boundary; escrowInTx is.
    const payment = await ctx.prisma.$transaction((tx) =>
      payments.createForShipment(
        tx,
        { id: shipment.id, reference: shipment.reference, userId: customer.userId, totalMinor: 1500n, currency: 'BZD' },
        { userId: customer.userId },
      ),
    );
    // Captured FRESH from the DB, not trusted from the returned object:
    // createForShipment's own return value is the pre-transition snapshot
    // (its last internal step moves CREATED -> PENDING, a real, legitimate
    // transition that has nothing to do with this test), so asserting
    // against the returned `.status` would measure createForShipment's own
    // internal bookkeeping, not what this test actually cares about —
    // exactly the "measuring the fixture, not the action" mistake caught
    // once already on this card.
    const beforeAttempt = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

    // THE SINK, DRIVEN DIRECTLY, WITH A MISMATCHED ACTOR — no HTTP route
    // anywhere in this codebase can even construct this call today; this is
    // the boundary itself, not a caller of it.
    await expect(
      ctx.prisma.$transaction((tx) => payments.escrowInTx(tx, payment.id, { userId: outsider.userId })),
    ).rejects.toThrow(ForbiddenException);

    const unchanged = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(unchanged.status, 'a mismatched actor must not change the payment\'s status at all').toBe(beforeAttempt.status);
    expect(unchanged.status, 'a mismatched actor must not advance the payment to AUTHORIZED').not.toBe('AUTHORIZED');

    const after = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedBalanceMinor, 'a mismatched actor must not move the real owner\'s wallet balance').toBe(before.cachedBalanceMinor);

    const entriesAfter = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: wallet.id } });
    expect(entriesAfter.length, 'a mismatched actor must not post NEW ledger entries against the real owner\'s wallet').toBe(entriesBefore.length);
  });

  it('ORDERING: the ownership check fires BEFORE the AUTHORIZED-status early return — a non-owner REPLAY against an already-authorized payment is refused, not silently no-op\'d', async () => {
    const customer = await registerUser(`sink_owner2_${uniq()}@example.com`);
    const outsider = await registerUser(`sink_outsider2_${uniq()}@example.com`);
    await post(admin, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 50_000, reason: 'BMPL-378 sink ordering test.' });

    const shipment = await bookUnpaidShipment(customer.cookies);
    const payment = await ctx.prisma.$transaction((tx) =>
      payments.createForShipment(
        tx,
        { id: shipment.id, reference: shipment.reference, userId: customer.userId, totalMinor: 1500n, currency: 'BZD' },
        { userId: customer.userId },
      ),
    );

    // Legitimately authorize it first, by its real owner — this is the
    // ordinary path, and it must still work.
    await ctx.prisma.$transaction((tx) => payments.escrowInTx(tx, payment.id, { userId: customer.userId }));
    const authorized = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(authorized.status).toBe('AUTHORIZED');

    // THE ORDERING ASSERTION ITSELF. escrowInTx's own early return for a
    // concurrent replay reads `if (fresh.status === 'AUTHORIZED') return;` —
    // silent, no throw, by design, for the SAME actor replaying a request
    // that already landed. If the ownership check sat AFTER that line, a
    // non-owner replaying against an already-authorized payment would hit
    // the SAME silent return and look identical to a legitimate replay in
    // every other test in this codebase. It must not: the ownership check
    // has to run first, so a mismatched actor is refused REGARDLESS of the
    // payment's current status, not only while it is still pending.
    await expect(
      ctx.prisma.$transaction((tx) => payments.escrowInTx(tx, payment.id, { userId: outsider.userId })),
    ).rejects.toThrow(ForbiddenException);

    // The contrast that proves the ordering: the SAME already-AUTHORIZED
    // payment, replayed by its REAL owner, still resolves silently (the
    // legitimate concurrent-replay case this early return exists for).
    await expect(
      ctx.prisma.$transaction((tx) => payments.escrowInTx(tx, payment.id, { userId: customer.userId })),
    ).resolves.toBeUndefined();

    const stillAuthorized = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stillAuthorized.status).toBe('AUTHORIZED');
  });
});
