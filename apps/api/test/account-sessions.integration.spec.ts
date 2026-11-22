/**
 * ACCT-SESSIONS — list/revoke a user's own sessions, against real
 * PostgreSQL. Covers: the list never leaks the refresh token hash and
 * marks exactly one row as the caller's own current session; revoking a
 * DIFFERENT session logs only that one out; revoking the caller's OWN
 * current session behaves as an honest logout (clears cookies); revoke is
 * idempotent on an already-revoked or already-expired session; "sign out
 * everywhere else" leaves the caller's own session alone; and the
 * adversarial case this card exists to close — user A must not be able to
 * revoke user B's session by id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, cookieValue, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

async function register(email: string, password: string) {
  const res = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'S', lastName: 'X', acceptedTerms: true });
  return cookiesOf(res);
}

async function login(email: string, password: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  return cookiesOf(res);
}

async function listSessions(cookies: string[]) {
  const res = await request(ctx.server).get('/api/me/sessions').set('Cookie', cookies);
  expect(res.status).toBe(200);
  return res.body.sessions as Array<{
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    client: string;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
    current: boolean;
  }>;
}

describe('ACCT-SESSIONS: list', () => {
  it('lists only this account\'s own live sessions, marks exactly one current per caller, and never the refresh token hash', async () => {
    const email = 'sessions-list@example.bz';
    const password = 'SessionsPass123';
    const session1 = await register(email, password);
    const session2 = await login(email, password);
    const session3 = await login(email, password);

    const asSession1 = await listSessions(session1);
    expect(asSession1).toHaveLength(3);
    expect(asSession1.filter((s) => s.current)).toHaveLength(1);
    const currentFromSession1 = asSession1.find((s) => s.current)!.id;

    const asSession2 = await listSessions(session2);
    expect(asSession2).toHaveLength(3);
    expect(asSession2.filter((s) => s.current)).toHaveLength(1);
    const currentFromSession2 = asSession2.find((s) => s.current)!.id;

    // Same three sessions either way; WHICH one is "current" depends on who's asking.
    expect(currentFromSession1).not.toBe(currentFromSession2);
    expect(asSession1.map((s) => s.id).sort()).toEqual(asSession2.map((s) => s.id).sort());

    for (const s of asSession1) {
      expect(Object.keys(s).sort()).toEqual(
        ['client', 'createdAt', 'current', 'expiresAt', 'id', 'ipAddress', 'lastUsedAt', 'userAgent'].sort(),
      );
    }
    // Never the hash or anything derived from it, at the wire level -- not
    // merely "the key we expect to be absent is absent" (which session3
    // existing but unused here would already satisfy by construction).
    expect(JSON.stringify({ asSession1, asSession2, session3 })).not.toContain('refreshTokenHash');
  });

  it('excludes an already-expired session from the list entirely', async () => {
    const email = 'sessions-expired-list@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);
    await login(email, password);

    const before = await listSessions(current);
    expect(before).toHaveLength(2);
    const other = before.find((s) => !s.current)!;

    await ctx.prisma.session.update({ where: { id: other.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const after = await listSessions(current);
    expect(after).toHaveLength(1);
    expect(after[0]!.current).toBe(true);
  });
});

describe('ACCT-SESSIONS: revoke one', () => {
  it('revoking a DIFFERENT session logs only that session out, leaving the caller\'s own session and cookies untouched', async () => {
    const email = 'sessions-revoke-other@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);
    const other = await login(email, password);

    const list = await listSessions(current);
    const otherId = list.find((s) => !s.current)!.id;

    const revoke = await request(ctx.server).delete(`/api/me/sessions/${otherId}`).set('Cookie', current);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toEqual({ ok: true });
    // The caller's own session was not touched -- nothing to clear.
    expect(cookiesOf(revoke)).toHaveLength(0);

    const otherAccess = cookieValue(other, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${otherAccess}`])).status).toBe(401);

    const currentAccess = cookieValue(current, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${currentAccess}`])).status).toBe(200);
  });

  it('revoking the CALLER\'S OWN CURRENT session behaves as an honest logout -- clears cookies, and the token stops working', async () => {
    const email = 'sessions-revoke-self@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);

    const list = await listSessions(current);
    const ownId = list.find((s) => s.current)!.id;

    const revoke = await request(ctx.server).delete(`/api/me/sessions/${ownId}`).set('Cookie', current);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toEqual({ ok: true });
    // Cleared the way the deletion/password-change paths already do.
    expect(cookiesOf(revoke).some((c) => c.startsWith('access_token=;'))).toBe(true);
    expect(cookiesOf(revoke).some((c) => c.startsWith('refresh_token=;'))).toBe(true);

    const access = cookieValue(current, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`])).status).toBe(401);
  });

  it('is idempotent on an already-revoked session -- no error on the second call', async () => {
    const email = 'sessions-revoke-twice@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);
    await login(email, password);

    const list = await listSessions(current);
    const otherId = list.find((s) => !s.current)!.id;

    const first = await request(ctx.server).delete(`/api/me/sessions/${otherId}`).set('Cookie', current);
    expect(first.status).toBe(200);
    const second = await request(ctx.server).delete(`/api/me/sessions/${otherId}`).set('Cookie', current);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });
  });

  it('succeeds without error on an already-expired session, reachable from a stale list', async () => {
    const email = 'sessions-revoke-expired@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);
    await login(email, password);

    const list = await listSessions(current);
    const otherId = list.find((s) => !s.current)!.id;
    await ctx.prisma.session.update({ where: { id: otherId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const revoke = await request(ctx.server).delete(`/api/me/sessions/${otherId}`).set('Cookie', current);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toEqual({ ok: true });

    const row = await ctx.prisma.session.findUniqueOrThrow({ where: { id: otherId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('ADVERSARIAL: user A cannot revoke user B\'s session by id -- it 404s, and B\'s session is untouched', async () => {
    const passwordA = 'SessionsPassA123';
    const passwordB = 'SessionsPassB123';
    const cookiesA = await register('sessions-user-a@example.bz', passwordA);
    const cookiesB = await register('sessions-user-b@example.bz', passwordB);

    const listB = await listSessions(cookiesB);
    const bSessionId = listB.find((s) => s.current)!.id;

    const attempt = await request(ctx.server).delete(`/api/me/sessions/${bSessionId}`).set('Cookie', cookiesA);
    expect(attempt.status).toBe(404);

    const bAccess = cookieValue(cookiesB, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${bAccess}`])).status).toBe(200);
  });

  it('404s a session id that does not exist at all, the same as one belonging to someone else', async () => {
    const cookies = await register('sessions-notfound@example.bz', 'SessionsPass123');
    const res = await request(ctx.server).delete('/api/me/sessions/does-not-exist').set('Cookie', cookies);
    expect(res.status).toBe(404);
  });
});

describe('ACCT-SESSIONS: revoke others', () => {
  it('"sign out everywhere else" revokes every OTHER session, leaves the caller\'s own alive, and clears no cookies', async () => {
    const email = 'sessions-revoke-others@example.bz';
    const password = 'SessionsPass123';
    const current = await register(email, password);
    const other1 = await login(email, password);
    const other2 = await login(email, password);

    const res = await request(ctx.server).post('/api/me/sessions/revoke-others').set('Cookie', current);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, revokedCount: 2 });
    expect(cookiesOf(res)).toHaveLength(0);

    const access1 = cookieValue(other1, 'access_token')!;
    const access2 = cookieValue(other2, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access1}`])).status).toBe(401);
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access2}`])).status).toBe(401);

    const currentAccess = cookieValue(current, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${currentAccess}`])).status).toBe(200);

    const after = await listSessions(current);
    expect(after).toHaveLength(1);
    expect(after[0]!.current).toBe(true);

    // MDF-951: a bulk security action -- unlike plain logout or revoking
    // one named session, "sign out everywhere else" is audited.
    const userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'SESSIONS_REVOKED_OTHERS', targetUserId: userId } });
    expect(log).toBeTruthy();
    expect(log?.actorId).toBe(userId);
    expect(log?.newValue).toEqual({ revokedCount: 2 });
  });

  it('reports zero revoked when there is nothing else to revoke, and still audits the call', async () => {
    const email = 'sessions-revoke-others-none@example.bz';
    const cookies = await register(email, 'SessionsPass123');
    const res = await request(ctx.server).post('/api/me/sessions/revoke-others').set('Cookie', cookies);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, revokedCount: 0 });

    const userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'SESSIONS_REVOKED_OTHERS', targetUserId: userId } });
    expect(log).toBeTruthy();
    expect(log?.newValue).toEqual({ revokedCount: 0 });
  });
});
