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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, raceOverSeparateConnections, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ENV } from '../src/config/config.module';
import { ADMIN_TEST_CREDIT_WINDOW_MS } from '../src/wallet/wallet.service';

let ctx: TestContext;
let env: Record<string, unknown>;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

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

  // MDF-499 FOLLOW-UP (owner §10, "duplicate, concurrent and retried
  // actions"): the comment this test used to carry said, from inference, that
  // two supertest requests fired together did not reliably interleave their
  // reads here. raceOverSeparateConnections (test/helpers.ts) replaces that
  // inference with a direct pg_stat_activity measurement.
  //
  // OBSERVED, not assumed: the confirmed run measured peakConcurrentActive=4
  // (51 samples) — four of these five requests' queries were genuinely
  // active at the same instant, measured, not inferred from timing. Under
  // that proven race the invariant held: exactly one credit, cap never
  // exceeded. The real protections are the FOR UPDATE lock and the unique
  // transaction reference in selfServiceTestCredit (wallet.service.ts), not
  // this test — but this is no longer an assumed pass against an unforced
  // race; the race was forced and the lock held. Treat a failure here as a
  // real regression.
  it('D · N simultaneous first claims yield exactly one credit', async () => {
    const me = await registerCustomer(`ssf_race_${uniq()}@example.bz`);
    const probe = await raceOverSeparateConnections(ctx.prisma, [1, 2, 3, 4, 5].map(() => () => post(me.cookies, 'wallet/test-fund')));
    console.log(
      `[CONCURRENCY selfServiceTestCredit] ${probe.observed ? 'OBSERVED' : 'NOT-FORCED'} ` +
      `(peakConcurrentActive=${probe.peakConcurrentActive}, samples=${probe.samples}, elapsedMs=${probe.elapsedMs})`,
    );
    const statuses = probe.responses.map((r) => r.status).sort();
    expect(statuses, `statuses: ${JSON.stringify(statuses)}`).toEqual([201, 409, 409, 409, 409]);

    const wallet = await walletOf(me.userId);
    const credits = await ctx.prisma.walletLedgerEntry.findMany({
      where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Self-Service Test Credit' } },
    });
    expect(credits).toHaveLength(1);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(CAP);   // never more than the cap, however many racers
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

  // MDF-512. The exact counterpart of test D above, and it does NOT hold.
  //
  // Jim live-proved the UI half with Playwright: the admin console's test-credit
  // control dispatches two real requests in one synchronous tick on a double
  // click (code-confirmed, not completed against the shared UAT wallet — he
  // deliberately stopped short of that). This is the server-side measurement
  // that turns it from code-confirmed into OBSERVED.
  //
  // adminTestCredit (wallet.service.ts) has neither of selfServiceTestCredit's
  // two defences: no `SELECT ... FOR UPDATE` lock, and its transaction
  // reference — `admin-test-credit:${userId}:${Date.now()}` — is wall-clock
  // derived, not state-derived. Two racers milliseconds apart get two
  // different references and never collide at all; two racers landing in the
  // SAME millisecond collide on that reference by accident, which is luck,
  // not a defence — and when they do, nothing catches the P2002 the way
  // selfServiceTestCredit's `.catch` does, so it reaches the client as a raw
  // 500 instead of a clean 409.
  //
  // THE INVARIANT under test (asserted unconditionally): exactly one credit
  // posts for one authorised admin action, and no racer gets a raw 500.
  //
  // OBSERVED, not assumed, across two confirmed runs — both measured
  // peakConcurrentActive=5 (all five requests' queries genuinely active at
  // the same instant), and both show the double-credit, just via different
  // symptoms depending on whether any two racers' Date.now() happened to
  // collide:
  //   - one run: statuses [201,201,201,201,201] — no collision, FIVE separate
  //     credits posted for one administrator action;
  //   - another run: statuses [500,201,201,201,201] — one collision, caught
  //     as an unhandled P2002 (raw 500, the "luck" case above), the other
  //     FOUR each still posted their own separate credit.
  // Either way: one authorised action, far more than one credit.
  //
  // Left FAILING on purpose, same as assignPlacement's. This is the forcing
  // reproduction for Pam's fix (owner §11 financial-safety lane, after the
  // carrier API) — a red test is how she knows when she is done.
  //
  // DESIGN NOTE for whoever fixes this, including god if he'd specified it
  // himself: do NOT copy selfServiceTestCredit's state-derived reference
  // pattern here. That pattern works only because a cumulative CAP makes any
  // repeat illegitimate by construction. An administrator may legitimately
  // grant the same user the same amount twice, on purpose, as two separate
  // decisions — so a server-derived reference would either still let true
  // duplicates through (if derived from something that differs per call) or
  // start blocking real, intentional second grants (if derived from something
  // that doesn't). The honest fix needs an idempotency key supplied PER USER
  // ACTION — meaning the admin console UI has to generate and send one per
  // click — not a cleverer server-side derivation.
  it('P · N simultaneous admin test-credits for the same user do NOT collapse to one (MDF-512)', async () => {
    const me = await registerCustomer(`ssf_admin_race_${uniq()}@example.bz`);
    const amountMinor = 8_000;
    const probe = await raceOverSeparateConnections(
      ctx.prisma,
      [1, 2, 3, 4, 5].map(() => () => post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 race reproduction' })),
    );
    console.log(
      `[CONCURRENCY adminTestCredit] ${probe.observed ? 'OBSERVED' : 'NOT-FORCED'} ` +
      `(peakConcurrentActive=${probe.peakConcurrentActive}, samples=${probe.samples}, elapsedMs=${probe.elapsedMs})`,
    );
    const statuses = probe.responses.map((r) => r.status);
    // A losing racer colliding on the wall-clock reference must still fail
    // CLEANLY, never leak a raw 500 — same clean-failure bar as assignPlacement.
    expect(statuses.every((s) => s !== 500), `statuses: ${JSON.stringify(statuses)}`).toBe(true);

    const wallet = await walletOf(me.userId);
    const credits = await ctx.prisma.walletLedgerEntry.findMany({
      where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Administrative Test Credit' } },
    });
    // The real invariant, and the one expected to fail: one authorised admin
    // action must post exactly one credit, not one credit per racer that
    // happened to get a distinct wall-clock reference.
    expect(credits, `credits posted: ${credits.length} (expected 1); statuses: ${JSON.stringify(statuses)}`).toHaveLength(1);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor, `totalMinor: ${summary.body.totalMinor} (expected ${amountMinor})`).toBe(amountMinor);
  });

  // The fix for P above. "No duplicate" is not satisfied by the second call
  // silently doing nothing — it must hand back the SAME credit it already
  // posted, as a success, not a refusal and not a second row.
  it('Q · a replayed admin test-credit (same user/amount/actor, inside the window) returns the SAME credit id, not a silent no-op (MDF-512)', async () => {
    const me = await registerCustomer(`ssf_admin_replay_${uniq()}@example.bz`);
    const amountMinor = 6_000;
    const wallet = await walletOf(me.userId);
    const creditIds = () =>
      ctx.prisma.walletLedgerEntry
        .findMany({ where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Administrative Test Credit' } }, select: { transactionId: true } })
        .then((rows) => rows.map((r) => r.transactionId));

    const first = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 replay check' });
    expect(first.status).toBe(201);
    const afterFirst = await creditIds();
    expect(afterFirst).toHaveLength(1);

    const second = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 replay check' });
    expect(second.status, `replay must succeed, never a raw 500: ${second.status}`).toBe(201);
    const afterSecond = await creditIds();
    expect(afterSecond, `expected the same single credit back, got: ${JSON.stringify(afterSecond)}`).toEqual(afterFirst);

    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(amountMinor);
  });

  // The legitimate case the bucket must never break: an administrator who
  // really does mean to grant the same user the same amount twice, as two
  // separate decisions, each carrying its own explicit key.
  it('R · two admin test-credits with DIFFERENT explicit idempotency keys post as two separate credits, even same user and amount (MDF-512)', async () => {
    const me = await registerCustomer(`ssf_admin_keys_${uniq()}@example.bz`);
    const amountMinor = 4_000;

    const first = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 key A', idempotencyKey: `k1-${uniq()}` });
    expect(first.status).toBe(201);
    const second = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 key B', idempotencyKey: `k2-${uniq()}` });
    expect(second.status).toBe(201);

    const wallet = await walletOf(me.userId);
    const credits = await ctx.prisma.walletLedgerEntry.findMany({
      where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Administrative Test Credit' } },
    });
    expect(credits, `expected two distinct credits, got: ${credits.length}`).toHaveLength(2);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(amountMinor * 2);
  });

  // THE test that distinguishes "bucketed reference" from "sliding-window
  // read under the lock": both P and Q above pass under either design, so
  // neither proves which one is actually running. A bucketed reference
  // alone lets two requests straddling a bucket boundary get two DIFFERENT
  // references and both legitimately post — "duplicates are rare", not
  // "duplicates never happen". This fails against the bucket alone and
  // passes once the lock-held lookback read is in place.
  it('S · two admin test-credits deliberately straddling a bucket boundary still collapse to exactly one credit (MDF-512)', async () => {
    const me = await registerCustomer(`ssf_admin_straddle_${uniq()}@example.bz`);
    const amountMinor = 5_000;
    const base = Date.now();
    const bucket = Math.floor(base / ADMIN_TEST_CREDIT_WINDOW_MS);
    const boundary = (bucket + 1) * ADMIN_TEST_CREDIT_WINDOW_MS;
    // 1ms apart in (mocked) wall-clock time, on opposite sides of
    // Math.floor(now / WINDOW_MS) — exactly the straddle the bucket alone
    // cannot catch. Only Date.now() is mocked (never `new Date()` itself),
    // so the real createdAt Postgres stamps on each row is untouched, and
    // the window read's lower bound — derived from this same mocked
    // Date.now() — still sits comfortably before it.
    const spy = vi.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(boundary - 1);
      const first = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 boundary check' });
      expect(first.status).toBe(201);

      spy.mockReturnValue(boundary + 1);
      const second = await post(admin, 'admin/wallet/test-credit', { userId: me.userId, amountMinor, reason: 'MDF-512 boundary check' });
      expect(second.status, `the second call must replay, never post a second credit: ${second.status}`).toBe(201);
    } finally {
      spy.mockRestore();
    }

    const wallet = await walletOf(me.userId);
    const credits = await ctx.prisma.walletLedgerEntry.findMany({
      where: { accountId: wallet.id, direction: 'CREDIT', transaction: { description: 'Administrative Test Credit' } },
    });
    expect(credits, `expected exactly one credit across the boundary, got: ${credits.length}`).toHaveLength(1);
    const summary = await get(me.cookies, 'wallet');
    expect(summary.body.totalMinor).toBe(amountMinor);
  });
});
