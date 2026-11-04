/**
 * SHIPPING-E2E-CLOSE — `GET /admin/wallet/users/:userId/accounts`.
 *
 * Before this, there was no read path from a userId to that user's own
 * wallet status at all: `WalletController.summary()` is hardcoded to
 * `@CurrentUser()` (self only), and `adminAccounts()` is hard-filtered to
 * `userId: null` (system/escrow accounts only). The only way an administrator
 * could ever learn a wallet's status was to fire `POST .../lock` or
 * `.../unlock` and read the response — which posts a real audit row and
 * alerts every `wallet.lock` holder, just to look. This route exists only to
 * make that unnecessary: a pure read, symmetric with the lock/unlock
 * addressing shape (by userId), returning the account row(s) an admin needs
 * to decide whether locking is even sensible (status, and the balance,
 * because "is there money in it" is part of the same decision).
 *
 * The property the whole design rests on is the last test below: this route
 * writes NOTHING. No audit row, no notification, no money movement — if a
 * read path to wallet status ever needs anything beyond the existing
 * lock/unlock audit trail, that is a different, larger decision than this PR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN_TEST_CREDIT_MAX_MINOR } from '@bmpl/validation';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'admin-wallet-user-accounts fixture' });
  expect(r.status).toBe(201);
}

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

describe('GET /admin/wallet/users/:userId/accounts', () => {
  it('is refused without wallet.read', async () => {
    const limited = await seedLimitedAdmin(ctx.prisma, `limited_${uniq()}@example.bz`, ['wallet.lock']);
    const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: limited.email, password: limited.password }));
    const customer = await registerCustomer(`target_${uniq()}@example.com`);

    const r = await get(cookies, `admin/wallet/users/${customer.userId}/accounts`);
    expect(r.status).toBe(403);
  });

  it('returns the user\'s own USER-type account, with status and balance, addressed by the same userId the lock endpoint uses', async () => {
    const customer = await registerCustomer(`target_${uniq()}@example.com`);
    await fund(customer.userId, 12_345);

    const r = await get(admin, `admin/wallet/users/${customer.userId}/accounts`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    const account = r.body[0];
    expect(account.type).toBe('USER');
    expect(account.status).toBe('ACTIVE');
    expect(account.currency).toBe('BZD');
    expect(account.cachedBalanceMinor).toBe(12_345);

    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    expect(account.id).toBe(wallet.id);
  });

  it('reflects LOCKED status once the existing lock endpoint is used — this route does not duplicate that control, only reads it', async () => {
    const customer = await registerCustomer(`target_${uniq()}@example.com`);
    await fund(customer.userId, 500);
    const lock = await post(admin, `admin/wallet/users/${customer.userId}/lock`, { reason: 'Fixture: admin-wallet-user-accounts test' });
    expect(lock.status).toBe(201);

    const r = await get(admin, `admin/wallet/users/${customer.userId}/accounts`);
    expect(r.status).toBe(200);
    expect(r.body[0].status).toBe('LOCKED');
  });

  it('a user with no wallet account returns an empty array, not an error', async () => {
    // Registration creates a USER wallet account eagerly (auth.service.ts:70),
    // so "no wallet" is not reachable through the ordinary signup flow for any
    // real customer — removed here directly to exercise the defensive case the
    // route still has to handle correctly (a user row that predates wallets, or
    // any other path that never got one).
    const customer = await registerCustomer(`nowallet_${uniq()}@example.com`);
    await ctx.prisma.walletAccount.deleteMany({ where: { userId: customer.userId, type: 'USER' } });

    const r = await get(admin, `admin/wallet/users/${customer.userId}/accounts`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('writes NOTHING — no audit row, no notification — reading status is free, unlike firing lock/unlock to probe it', async () => {
    const customer = await registerCustomer(`target_${uniq()}@example.com`);
    await fund(customer.userId, 1_000);

    const auditBefore = await ctx.prisma.auditLog.count();
    const notificationsBefore = await ctx.prisma.notification.count();

    const r = await get(admin, `admin/wallet/users/${customer.userId}/accounts`);
    expect(r.status).toBe(200);

    expect(await ctx.prisma.auditLog.count()).toBe(auditBefore);
    expect(await ctx.prisma.notification.count()).toBe(notificationsBefore);
  });
});

/**
 * MDF-499: ADMIN_TEST_CREDIT_MAX_MINOR is exported from @bmpl/validation
 * specifically so the admin UI's displayed ceiling and the server's own
 * rejection can never quote two different numbers — but every existing
 * fixture in this suite posts EXACTLY the cap (100_000) as a convenient
 * round max value, so the server's own refusal above it had never actually
 * been exercised. The UI's client-side check is only a round-trip-saving
 * hint (WalletOperations.tsx); this proves the server enforces its own
 * copy of the same ceiling even when a request bypasses that hint entirely.
 */
describe('POST /admin/wallet/test-credit — server-side amount ceiling (MDF-499)', () => {
  it('refuses an amount one minor unit over the ceiling, even sent directly with no client-side hint involved', async () => {
    const customer = await registerCustomer(`target_${uniq()}@example.com`);
    const r = await post(admin, 'admin/wallet/test-credit', {
      userId: customer.userId,
      amountMinor: ADMIN_TEST_CREDIT_MAX_MINOR + 1,
      reason: 'MDF-499 over-cap probe',
    });
    expect(r.status).toBe(400);
    // Registration creates a USER wallet account eagerly (auth.service.ts:70)
    // -- the refusal must mean no credit posted, not that the account itself
    // never existed.
    const accounts = await get(admin, `admin/wallet/users/${customer.userId}/accounts`);
    expect(accounts.body[0]?.cachedBalanceMinor ?? 0).toBe(0);
  });

  it('accepts exactly the ceiling amount — the cap is inclusive, not exclusive', async () => {
    const customer = await registerCustomer(`target_${uniq()}@example.com`);
    const r = await post(admin, 'admin/wallet/test-credit', {
      userId: customer.userId,
      amountMinor: ADMIN_TEST_CREDIT_MAX_MINOR,
      reason: 'MDF-499 at-cap probe',
    });
    expect(r.status).toBe(201);
  });
});
