/**
 * POST /shipping had no Idempotency-Key protection: a dropped connection or a
 * resubmitted form could double-book and double-charge a real customer. This
 * mirrors marketplace checkout's existing Idempotency-Key pattern
 * (shipment-payments.integration.spec.ts already proves two DISTINCT bookings
 * are two shipments each charged once -- that is not what this file is
 * about). This file proves the REPLAY path: the same key never creates a
 * second shipment or a second charge.
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

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** Belize City to Belize City: one courier, no terminal, priced locally. */
const localParcel = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
  destination: { district: 'BELIZE', city: 'Belize City', address: '18 Newtown Barracks', name: 'Recipient', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

function bookShipment(cookies: string[], body: Record<string, unknown> = {}, idempotencyKey?: string) {
  const req = request(ctx.server).post('/api/shipping').set('Cookie', cookies);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send({ ...localParcel(), payWithWallet: true, ...body });
}

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'Shipping idempotency-key tests.' });
  expect(r.status).toBe(201);
}

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
  await ctx.prisma.idempotencyKey.deleteMany({ where: { scope: 'shipping' } });
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await setLocalCourierFee(BigInt(PRICE));

  const c = await registerCustomer(`shipidem_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  await fund(customerId, 10_000);
});

describe('replaying a booking with the same Idempotency-Key', () => {
  it('returns the original shipment and charges exactly once', async () => {
    const first = await bookShipment(customer, {}, 'key-abc');
    expect(first.status).toBe(201);
    const shipmentId = first.body.id;

    const second = await bookShipment(customer, {}, 'key-abc');
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(shipmentId);

    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customerId } })).toBe(1);
    expect(await ctx.prisma.payment.count({ where: { shipmentId } })).toBe(1);

    expect(await ctx.prisma.auditLog.count({ where: { action: 'IDEMPOTENCY_KEY_REPLAYED' } })).toBeGreaterThan(0);
    const row = await ctx.prisma.idempotencyKey.findFirstOrThrow({ where: { userId: customerId, scope: 'shipping', key: 'key-abc' } });
    expect(row.resultShipmentId).toBe(shipmentId);
    expect(row.status).toBe('COMPLETED');
  });

  it('leaves the wallet charged only once across the replay', async () => {
    await bookShipment(customer, {}, 'key-bal');
    await bookShipment(customer, {}, 'key-bal');

    const after = await request(ctx.server).get('/api/wallet').set('Cookie', customer);
    expect(after.body.availableMinor).toBe(10_000 - PRICE);
  });
});

describe('two different keys', () => {
  it('create two distinct shipments, each charged once', async () => {
    const a = await bookShipment(customer, {}, 'key-one');
    const b = await bookShipment(customer, {}, 'key-two');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);

    for (const id of [a.body.id, b.body.id]) {
      expect(await ctx.prisma.payment.count({ where: { shipmentId: id } })).toBe(1);
    }
    const after = await request(ctx.server).get('/api/wallet').set('Cookie', customer);
    expect(after.body.availableMinor).toBe(10_000 - PRICE * 2);
  });
});

describe('no key supplied', () => {
  it('behaves exactly as today — two identical bookings are two shipments', async () => {
    const a = await bookShipment(customer);
    const b = await bookShipment(customer);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await ctx.prisma.idempotencyKey.count({ where: { scope: 'shipping' } })).toBe(0);
  });
});

describe('a key already in progress (synthetic state -- NOT what a genuine concurrent race produces)', () => {
  it('refuses a second call against a row real traffic cannot leave behind', async () => {
    // This plants a row that is visible to another reader (COMMITTED) with
    // status IN_PROGRESS and NO resultShipmentId -- a state that, under the
    // CURRENT one-transaction design, genuine concurrent traffic can never
    // actually produce: see "two real concurrent requests" below, where the
    // reservation and the completion write share one $transaction and
    // therefore always commit together. Real traffic that races on this
    // path takes the REPLAY branch (201, same shipment), not this one.
    //
    // This test exists only to prove the defensive ConflictException branch
    // in shipment.service.ts's create() still does the right thing IF that
    // transaction shape ever changes (e.g. the reservation moves to its own
    // transaction ahead of the main one) and a visible, still-pending row
    // becomes possible. Do not read this test as evidence that a real race
    // returns 409 today -- it does not; see the test below.
    await ctx.prisma.idempotencyKey.create({
      data: { userId: customerId, scope: 'shipping', key: 'key-inflight', status: 'IN_PROGRESS' },
    });

    const r = await bookShipment(customer, {}, 'key-inflight');
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/already in progress/i);
    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customerId } })).toBe(0);
  });
});

describe('two real concurrent requests on a brand-new key (the actual field case)', () => {
  it('both calls succeed with the SAME shipment (one creation, one replay) -- never a 500, never two shipments', async () => {
    // Neither request has used this key before, so BOTH pass the fast-path
    // lookup in create() and both enter runCreate(). Only one can win the
    // (userId, scope, key) unique constraint on the reservation INSERT --
    // but because the reservation and the terminal-status write share one
    // $transaction, Postgres does not unblock the loser's conflicting INSERT
    // until the winner's transaction has fully COMMITTED. So by the time the
    // loser observes its own P2002, resultShipmentId is already set, and
    // create()'s catch block takes the replay branch, not the "already in
    // progress" ConflictException -- the loser gets 201 with the winner's
    // shipment, not 409. That "already in progress" branch (proven reachable
    // above, by planting a visible IN_PROGRESS-with-no-result row directly)
    // cannot be reached by genuine concurrent traffic under this one-
    // transaction design; it guards a window that cannot occur here, same as
    // its mirror in orders.service.ts's runCheckout. What must hold instead,
    // and what this proves: never a 500, never two shipments, never two
    // charges -- both responses carry the SAME shipment id.
    const [a, b] = await Promise.all([bookShipment(customer, {}, 'key-race'), bookShipment(customer, {}, 'key-race')]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);

    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customerId } })).toBe(1);
    expect(await ctx.prisma.payment.count({ where: { shipmentId: a.body.id } })).toBe(1);

    const row = await ctx.prisma.idempotencyKey.findFirstOrThrow({ where: { userId: customerId, scope: 'shipping', key: 'key-race' } });
    expect(row.status).toBe('COMPLETED');
    expect(row.resultShipmentId).toBe(a.body.id);
  });
});
