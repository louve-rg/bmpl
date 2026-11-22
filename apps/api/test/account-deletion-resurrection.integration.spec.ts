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
 * `login()`), so EITHER half alone cannot complete a takeover on its own —
 * but an admin who knows a deleted account's row (its email is anonymized to
 * `deleted-<userId>@deleted.bmpl.internal`, not erased or unknowable to
 * someone with database or admin-console access) combined with a leaked or
 * intercepted pre-deletion reset-password email is a real, reachable chain.
 * That is why this test checks the deleted account's CURRENT (anonymized)
 * email for login, not the original one — a login attempt against the
 * original email fails regardless of this defect, because deletion already
 * changed the email; it would prove nothing about whether the fix works.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('a deleted account stays deleted', () => {
  it('admin restore is REFUSED, a pre-deletion reset token is REFUSED, and no route logs in afterwards', async () => {
    const email = 'resurrect-combined@example.bz';
    const password = 'ResurrectPass12345';
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password, firstName: 'D', lastName: 'L', acceptedTerms: true });
    const userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const login = (e: string, p: string) => request(ctx.server).post('/api/auth/login').send({ email: e, password: p });
    const cookies = cookiesOf(await login(email, password));

    // Mint the reset token while the account is still alive — this is the
    // exact "still unexpired, still unconsumed" token the defect concerned.
    await request(ctx.server).post('/api/auth/forgot-password').send({ email });
    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
    const token = tokenFromBody(inbox.body.body);
    expect(token).toBeTruthy();

    const deleted = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(deleted.status).toBe(200);
    const afterDelete = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterDelete.status).toBe('DEACTIVATED');
    expect(afterDelete.deletedAt).not.toBeNull();
    const anonymizedEmail = afterDelete.email;
    expect(anonymizedEmail).toBe(`deleted-${userId}@deleted.bmpl.internal`);

    const admin = await seedSuperAdmin(ctx.prisma, 'resurrect-admin@example.bz', 'AdminPass12345');
    const adminCookies = cookiesOf(await login(admin.email, admin.password));

    // (a) admin restore -> REFUSED.
    const restore = await request(ctx.server)
      .post('/api/admin/users/restore')
      .set('Cookie', adminCookies)
      .send({ userId });
    expect(restore.status).toBe(409);
    expect(restore.body.message).toBe('This account was deleted by its owner and cannot be restored.');
    const afterRestore = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterRestore.status).toBe('DEACTIVATED'); // not flipped to ACTIVE
    expect(afterRestore.deletedAt).not.toBeNull();

    // (b) the pre-deletion reset token -> REFUSED, and the password hash
    // the deletion wrote is still exactly what it was — not overwritten,
    // not silently consumed either (a second, identical attempt gets the
    // identical refusal, not an "already used" answer, which would mean it
    // got further than it should have).
    const attackerPassword = 'AttackerChosenPass99';
    const reset = await request(ctx.server).post('/api/auth/reset-password').send({ token, password: attackerPassword });
    expect(reset.status).toBe(400);
    expect(reset.body.message).toBe('This reset link is invalid or has expired.');
    const retry = await request(ctx.server).post('/api/auth/reset-password').send({ token, password: attackerPassword });
    expect(retry.status).toBe(400);
    expect(retry.body.message).toBe('This reset link is invalid or has expired.');
    const afterReset = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterReset.passwordHash).toBe(afterDelete.passwordHash);

    // (c) no route logs in: the original email is already unreachable (the
    // deletion itself anonymized it — true with or without this fix, so it
    // proves nothing on its own), and the account's actual current
    // (anonymized) email is still closed too, with every password that
    // could plausibly have worked if either half of the defect were open.
    expect((await login(email, password)).status).toBe(401);
    expect((await login(email, attackerPassword)).status).toBe(401);
    expect((await login(anonymizedEmail, password)).status).toBe(401);
    expect((await login(anonymizedEmail, attackerPassword)).status).toBe(401);
  });
});
