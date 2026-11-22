/**
 * ACCT-DELETED-ACCOUNT-RESURRECTION — acceptance-pass finding against main
 * 2539100a: a deleted account could be brought back to a working login two
 * different ways, neither of which checked `deletedAt` at all.
 *
 * Half one, no race needed: `AdminService.restoreUser` set `status: 'ACTIVE'`
 * on ANY user, including one that had been deleted — the column that records
 * "this person asked to be erased" was written by deletion and read by
 * nothing. Half two: `AuthService.resetPassword` looked a token up by hash
 * only, so a password-reset token minted BEFORE deletion — still unexpired,
 * still unconsumed — wrote a USABLE password hash over the deletion's
 * unusable one. Login itself gates on `status === 'ACTIVE'` (auth.service.ts
 * `login()`), so EITHER half alone cannot complete a takeover — but an admin
 * who knows a deleted account's row (its email is anonymized to
 * `deleted-<userId>@deleted.bmpl.internal`, not erased or unknowable to
 * someone with database or admin-console access) combined with a leaked or
 * intercepted pre-deletion reset-password email is a real, reachable chain.
 *
 * Three separate `it()` blocks, deliberately, sharing one deleted fixture via
 * `beforeAll`: a single test asserting all three facts aborts at the first
 * failing `expect`, so a regression in the restore refusal would silently
 * hide whether the token refusal and the login refusal still hold. Each
 * block must be able to fail and report on its own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];
const login = (e: string, p: string) =>
  request(ctx.server).post('/api/auth/login').send({ email: e, password: p });

const email = 'resurrect-combined@example.bz';
const password = 'ResurrectPass12345';
const attackerPassword = 'AttackerChosenPass99';
let userId: string;
let anonymizedEmail: string;
let passwordHashAfterDelete: string;
let resetToken: string;
let admin: { email: string; password: string };

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);

  await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'D', lastName: 'L', acceptedTerms: true });
  userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const cookies = cookiesOf(await login(email, password));

  // Mint the reset token while the account is still alive — this is the
  // exact "still unexpired, still unconsumed" token the defect concerned.
  await request(ctx.server).post('/api/auth/forgot-password').send({ email });
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
  resetToken = tokenFromBody(inbox.body.body) as string;
  expect(resetToken).toBeTruthy();

  const deleted = await request(ctx.server)
    .delete('/api/me')
    .set('Cookie', cookies)
    .send({ currentPassword: password });
  expect(deleted.status).toBe(200);

  const afterDelete = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  anonymizedEmail = afterDelete.email;
  passwordHashAfterDelete = afterDelete.passwordHash;
  expect(anonymizedEmail).toBe(`deleted-${userId}@deleted.bmpl.internal`);

  admin = await seedSuperAdmin(ctx.prisma, 'resurrect-admin@example.bz', 'AdminPass12345');
});
afterAll(async () => {
  await ctx.app.close();
});

describe('a deleted account stays deleted', () => {
  it('(a) admin restore is REFUSED on a deleted account', async () => {
    const adminCookies = cookiesOf(await login(admin.email, admin.password));
    const restore = await request(ctx.server)
      .post('/api/admin/users/restore')
      .set('Cookie', adminCookies)
      .send({ userId });
    expect(restore.status).toBe(409);
    expect(restore.body.message).toBe('This account was deleted by its owner and cannot be restored.');

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('DEACTIVATED'); // not flipped to ACTIVE
    expect(user.deletedAt).not.toBeNull();
  });

  it('(b) a password-reset token minted BEFORE deletion is REFUSED afterwards, and is never silently consumed', async () => {
    const reset = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: attackerPassword });
    expect(reset.status).toBe(400);
    expect(reset.body.message).toBe('This reset link is invalid or has expired.');

    // A second, identical attempt gets the identical refusal, not an
    // "already used" answer — which would mean it got further than it
    // should have on the first try.
    const retry = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: attackerPassword });
    expect(retry.status).toBe(400);
    expect(retry.body.message).toBe('This reset link is invalid or has expired.');

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe(passwordHashAfterDelete);
  });

  it('(c) the account still cannot sign in, by any route, after both attempts above', async () => {
    // The original email is already unreachable — deletion itself
    // anonymized it, true with or without this fix, so checking it proves
    // nothing about this defect on its own. The account's actual CURRENT
    // (anonymized) email is the one that matters: it is still closed too,
    // with every password that could plausibly have worked if either half
    // of the defect were still open.
    expect((await login(email, password)).status).toBe(401);
    expect((await login(email, attackerPassword)).status).toBe(401);
    expect((await login(anonymizedEmail, password)).status).toBe(401);
    expect((await login(anonymizedEmail, attackerPassword)).status).toBe(401);
  });
});
