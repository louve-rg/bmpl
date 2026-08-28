/**
 * TEMPORARY UAT FEATURE — self-issued simulation funds.
 *
 * A tester can put BZ$250 of simulation money into their OWN wallet so that
 * Marketplace and Shipping can be exercised without a payment rail, an
 * administrator, or working email. Everything dangerous about that sentence is
 * what these tests are about: that it is their own wallet and no other, that
 * the amount comes from the server and not the request, that the cap is
 * cumulative and survives two people clicking at once, that it is unmistakably
 * test money, and that with the flag off the endpoint does not exist.
 *
 * The flag is read per request from the same Env object the app was built with,
 * so it can be flipped between tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ENV } from '../src/config/config.module';

let ctx: TestContext;
let env: Record<string, unknown>;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const CAP = 25_000;

const post = (c: string[], p: string, b: object = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

const walletOf = (userId: string) =>
  ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER', currency: 'BZD' } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  env = ctx.app.get(ENV);
});
afterAll(async () => { await ctx.app.close(); });
beforeEach(() => {
  env.ENABLE_SELF_SERVICE_TEST_FUNDING = true;
  env.SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR = CAP;
  env.SELF_SERVICE_TEST_FUNDING_EXPIRES_AT = undefined;
});

describe('self-service UAT wallet funding', () => {
  it('A · refuses an unauthenticated caller', async () => {
    const res = await request(ctx.server).post('/api/wallet/test-fund').send({});
    expect(res.status).toBe(401);
  });

  it('B · credits exactly BZ$250 on a first claim, and J/K/L/M/N hold', async () => {
    const me = await registerCustomer(`ssf_first_${uniq()}@example.bz`);
    const res = await post(me.cookies, 'wallet/test-fund');
    expect(res.status).toBe(201);
    expect(res.body.creditedMinor).toBe(CAP);
    expect(res.body.cumulativeMinor).toBe(CAP);
    expect(res.body.remainingMinor).toBe(0);
    expect(res.body.wallet).toMatchObject({ availableMinor: CAP, onHoldMinor: 0, totalMinor: CAP });

    const txn = await ctx.prisma.walletTransaction.findUniqueOrThrow({
      where: { id: res.body.transactionId },
      include: { entries: { include: { account: true } } },
    });
    // J · unmistakably simulation money.
    expect(txn.isTest).toBe(true);
    expect(txn.type).toBe('TOPUP');
    expect(txn.status).toBe('POSTED');
    expect(txn.description).toBe('Self-Service Test Credit');

    // L · balanced double entry, credited to THEIR wallet, debited from clearing.
    const net = txn.entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
    const wallet = await walletOf(me.userId);
    const mine = txn.entries.find((e) => e.accountId === wallet.id);
    expect(mine?.direction).toBe('CREDIT');
    expect(mine?.amountMinor).toBe(BigInt(CAP));
    expect(txn.entries.find((e) => e.account.type === 'SYSTEM_TOPUP_CLEARING')?.direction).toBe('DEBIT');

    // K · their account classification is untouched.
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: me.userId } })).isTest).toBe(false);

    // M · audit row, naming them as the actor because they asked for it.
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'WALLET_SELF_SERVICE_TEST_FUNDING_GRANTED', targetUserId: me.userId },
    });
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(me.userId);
    expect(audit!.newValue).toMatchObject({ source: 'SELF_SERVICE_UAT', amountMinor: CAP });

    // N · it reads back in their own history, with no system account leaked.
    const history = await get(me.cookies, 'wallet/transactions');
    expect(history.status).toBe(200);
    const row = history.body.find((t: { id: string }) => t.id === res.body.transactionId);
    expect(row).toMatchObject({ description: 'Self-Service Test Credit', direction: 'IN', signedMinor: CAP, isTest: true });
    expect(JSON.stringify(history.body)).not.toContain('SYSTEM_TOPUP_CLEARING');
  });

  it('C · refuses a second claim and adds nothing', async () => {
    const me = await registerCustomer(`ssf_second_${uniq()}@example.bz`);
    expect((await post(me.cookies, 'wallet/test-fund')).status).toBe(201);

    const again = await post(me.cookies, 'wallet/test-fund');
    expect(again.status).toBe(409);
    expect(String(again.body.message)).toMatch(/already been issued/i);

    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(CAP);
    const status = await get(me.cookies, 'wallet/test-funding');
    expect(status.body).toMatchObject({ enabled: true, claimed: true, grantedMinor: CAP, remainingMinor: 0 });
  });

  it('C2 · spending does not restore the allowance', async () => {
    const me = await registerCustomer(`ssf_spend_${uniq()}@example.bz`);
    expect((await post(me.cookies, 'wallet/test-fund')).status).toBe(201);

    // Move money out the way a purchase would, through the ledger.
    const wallet = await walletOf(me.userId);
    const clearing = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_TOPUP_CLEARING' } });
    await ctx.prisma.walletTransaction.create({
      data: {
        type: 'ESCROW_HOLD', status: 'POSTED', currency: 'BZD', isTest: true,
        reference: `spend:${me.userId}`, description: 'Spent during test', postedAt: new Date(),
        entries: { create: [
          { accountId: wallet.id, direction: 'DEBIT', amountMinor: 10_000n },
          { accountId: clearing.id, direction: 'CREDIT', amountMinor: 10_000n },
        ] },
      },
    });

    const again = await post(me.cookies, 'wallet/test-fund');
    expect(again.status).toBe(409);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.availableMinor).toBe(CAP - 10_000);
  });

  // Honest scope: this guards the invariant, it does not demonstrate a race.
  // It passes against a version with the row lock removed, because two
  // supertest requests fired together did not reliably interleave their reads
  // here — the second ran after the first had committed. Treat a failure as a
  // real regression; do not read the pass as evidence that concurrent claiming
  // was exercised. The protections it stands over are the FOR UPDATE lock and
  // the unique transaction reference behind it.
  it('D · two simultaneous first claims yield exactly one credit', async () => {
    const me = await registerCustomer(`ssf_race_${uniq()}@example.bz`);
    const [a, b] = await Promise.all([
      post(me.cookies, 'wallet/test-fund'),
      post(me.cookies, 'wallet/test-fund'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const wallet = await walletOf(me.userId);
    const credits = await ctx.prisma.walletLedgerEntry.findMany({
      where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Self-Service Test Credit' } },
    });
    expect(credits).toHaveLength(1);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(CAP);   // never 50000
  });

  it('E/F/G · ignores an amount, a userId and a walletId in the body', async () => {
    const me = await registerCustomer(`ssf_body_${uniq()}@example.bz`);
    const victim = await registerCustomer(`ssf_victim_${uniq()}@example.bz`);
    const victimWallet = await ctx.prisma.walletAccount.findFirst({ where: { userId: victim.userId, type: 'USER' } });

    const res = await post(me.cookies, 'wallet/test-fund', {
      amountMinor: 1_000_000,
      amount: 1_000_000,
      userId: victim.userId,
      walletId: victimWallet?.id ?? 'anything',
      email: victim.email,
      currency: 'USD',
    });
    expect(res.status).toBe(201);
    // The server's amount, not theirs.
    expect(res.body.creditedMinor).toBe(CAP);
    // Their own wallet, not the victim's.
    const mine = await get(me.cookies, 'wallet');
    expect(mine.body.totalMinor).toBe(CAP);
    const theirs = await get(victim.cookies, 'wallet');
    expect(theirs.body.totalMinor).toBe(0);
  });

  it('H · is unavailable when the flag is off', async () => {
    const me = await registerCustomer(`ssf_off_${uniq()}@example.bz`);
    env.ENABLE_SELF_SERVICE_TEST_FUNDING = false;

    expect((await post(me.cookies, 'wallet/test-fund')).status).toBe(404);
    expect((await get(me.cookies, 'wallet/test-funding')).body).toEqual({ enabled: false });
    expect((await get(me.cookies, 'wallet')).body.totalMinor).toBe(0);
  });

  it('I · is unavailable when the flag is absent entirely', async () => {
    const me = await registerCustomer(`ssf_absent_${uniq()}@example.bz`);
    delete env.ENABLE_SELF_SERVICE_TEST_FUNDING;

    expect((await post(me.cookies, 'wallet/test-fund')).status).toBe(404);
    expect((await get(me.cookies, 'wallet')).body.totalMinor).toBe(0);
  });

  it('I2 · disarms itself once the configured expiry has passed', async () => {
    const me = await registerCustomer(`ssf_expired_${uniq()}@example.bz`);
    env.SELF_SERVICE_TEST_FUNDING_EXPIRES_AT = new Date(Date.now() - 60_000).toISOString();

    expect((await post(me.cookies, 'wallet/test-fund')).status).toBe(404);
    expect((await get(me.cookies, 'wallet/test-funding')).body).toEqual({ enabled: false });
  });

  it('O · an administrative test credit does not consume the self-service allowance', async () => {
    const me = await registerCustomer(`ssf_admin_${uniq()}@example.bz`);
    // The shape of Edward's BZ$80: granted by an administrator, separate action.
    const granted = await post(admin, 'admin/wallet/test-credit', {
      userId: me.userId, amountMinor: 8_000, reason: 'Client UAT testing credit',
    });
    expect(granted.status).toBe(201);

    const status = await get(me.cookies, 'wallet/test-funding');
    expect(status.body).toMatchObject({ claimed: false, grantedMinor: 0, remainingMinor: CAP });

    const res = await post(me.cookies, 'wallet/test-fund');
    expect(res.status).toBe(201);
    expect(res.body.creditedMinor).toBe(CAP);

    // Both credits stand, as separate transactions, and the balance is the sum.
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(CAP + 8_000);
    const descriptions = (await get(me.cookies, 'wallet/transactions')).body.map((t: { description: string }) => t.description);
    expect(descriptions).toContain('Administrative Test Credit');
    expect(descriptions).toContain('Self-Service Test Credit');
  });
});
