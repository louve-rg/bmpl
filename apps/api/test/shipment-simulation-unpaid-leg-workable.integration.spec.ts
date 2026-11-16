/**
 * MDF-777: a SIMULATION shipment's first leg must be workable without
 * payment, so an owner-provisioning rehearsal never writes a money row at
 * all — no Payment, no WalletHold, no WalletTransaction, no WalletLedgerEntry,
 * nothing in escrow or platform fees. Without this, a HUB_TO_HUB rehearsal
 * booked unpaid (to avoid exactly that money-row problem) could never depart
 * its own line-haul leg: departLeg only accepts READY/IN_PROGRESS, and an
 * unpaid leg was created PENDING with no other path to READY.
 *
 * The guard keys SOLELY on the shipment's own `isTest` (derived from the
 * booking customer's own account, never a request field) — proven both
 * directions: a simulation booking becomes workable, and a REAL unpaid
 * booking is bit-for-bit unaffected, still PENDING, still refusing to depart.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
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

/** Two hubs and one LINE_HAUL route between them, tagged `isTest` as given. */
async function seedHubToHubNetwork(isTest: boolean) {
  const tag = `${isTest ? 'SIM' : 'RL'}-${uniq().slice(-6)}`;
  const makeHub = async (suffix: 'A' | 'B') => {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: `${tag}-${suffix}`,
      name: `${isTest ? 'Simulation' : 'Real'} fixture hub ${suffix} (${tag})`,
      type: 'BMPL_HUB',
      district: 'BELIZE',
      city: 'Belize City',
      modes: ['LAND'],
      isTest,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const originHubId = await makeHub('A');
  const destinationHubId = await makeHub('B');
  const r = await post(admin, 'admin/logistics/routes', {
    originHubId,
    destinationHubId,
    mode: 'LAND',
    durationMinutes: 60,
    priceMinor: 5000,
    carrierName: 'Fixture Carrier',
    isTest,
  });
  expect(r.status).toBe(201);
  return { originHubId, destinationHubId };
}

const bookHubToHub = (cookies: string[], hubs: { originHubId: string; destinationHubId: string }, payWithWallet?: boolean) =>
  post(cookies, 'shipping', {
    service: 'HUB_TO_HUB',
    origin: { hubId: hubs.originHubId },
    destination: { hubId: hubs.destinationHubId, name: 'Recipient', phone: '501-444-5555' },
    description: 'Rehearsal cargo',
    ...(payWithWallet !== undefined ? { payWithWallet } : {}),
  });

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const depart = (legId: string, body: object = {}) => post(admin, `admin/logistics/legs/${legId}/depart`, body);

// Global counts, deliberately: beforeEach truncates every one of these tables,
// so by the time a test's single booking has run, a nonzero count can only be
// a row that booking itself wrote.
const moneyRowCounts = async (shipmentId: string) => {
  const [payments, holds, transactions, ledgerEntries] = await Promise.all([
    ctx.prisma.payment.count({ where: { shipmentId } }),
    ctx.prisma.walletHold.count(),
    ctx.prisma.walletTransaction.count(),
    ctx.prisma.walletLedgerEntry.count(),
  ]);
  return { payments, holds, transactions, ledgerEntries };
};

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
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
});

describe('a SIMULATION shipment\'s unpaid first leg is workable', () => {
  it('is created READY, writes zero money rows, and departs', async () => {
    const hubs = await seedHubToHubNetwork(true);
    const customer = await registerCustomer(`simrehearsal_${uniq()}@example.com`);
    await post(admin, 'admin/users/test-flag', { userId: customer.userId, isTest: true, reason: 'MDF-777 rehearsal.' });

    const booked = await bookHubToHub(customer.cookies, hubs);
    if (booked.status !== 201) throw new Error(`booking failed: ${booked.status} ${JSON.stringify(booked.body)}`);
    expect(booked.body.isTest).toBe(true);

    const legs = await legsOf(booked.body.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.kind).toBe('LINE_HAUL');
    expect(legs[0]!.status).toBe('READY');

    const counts = await moneyRowCounts(booked.body.id);
    expect(counts).toEqual({ payments: 0, holds: 0, transactions: 0, ledgerEntries: 0 });

    const departed = await depart(legs[0]!.id, {});
    expect(departed.status).toBe(201);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legs[0]!.id } });
    expect(after.status).toBe('IN_PROGRESS');
  });
});

describe('a REAL shipment\'s unpaid first leg is unaffected', () => {
  it('stays PENDING and refuses to depart', async () => {
    const hubs = await seedHubToHubNetwork(false);
    const customer = await registerCustomer(`realunpaid_${uniq()}@example.com`);

    const booked = await bookHubToHub(customer.cookies, hubs);
    if (booked.status !== 201) throw new Error(`booking failed: ${booked.status} ${JSON.stringify(booked.body)}`);
    expect(booked.body.isTest).toBe(false);

    const legs = await legsOf(booked.body.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.status).toBe('PENDING');

    const departed = await depart(legs[0]!.id, {});
    expect(departed.status).toBe(400);
    expect(departed.body.message).toMatch(/pending/i);

    const counts = await moneyRowCounts(booked.body.id);
    expect(counts).toEqual({ payments: 0, holds: 0, transactions: 0, ledgerEntries: 0 });
  });
});
