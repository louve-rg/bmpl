/**
 * Authentication workflow — integration against real PostgreSQL.
 * Covers: registration, automatic Customer role, argon2id hashing, duplicate +
 * invalid rejection, email verification (via dev mailbox), login, refresh-token
 * rotation, refresh-token reuse rejection, logout + revocation, password reset.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, cookieValue, resetDb, seedRoles, type TestContext } from './helpers';

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

describe('registration', () => {
  const email = 'auth_reg@example.bz';

  it('registers a customer, auto-grants CUSTOMER, and stores an argon2id hash', async () => {
    const res = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'Reg', lastName: 'User', acceptedTerms: true });
    expect(res.status).toBe(201);
    expect(cookiesOf(res).some((c) => c.startsWith('access_token='))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { roles: true },
    });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.status).toBe('ACTIVE');
    const customer = user.roles.find((r) => r.roleCode === 'CUSTOMER');
    expect(customer?.status).toBe('APPROVED');
  });

  it('rejects duplicate email registration', async () => {
    const res = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'Reg', lastName: 'User', acceptedTerms: true });
    expect(res.status).toBe(400);
  });

  it('rejects invalid registration data (weak password, missing terms)', async () => {
    const weak = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'weak@example.bz', password: 'short', firstName: 'A', lastName: 'B', acceptedTerms: true });
    expect(weak.status).toBe(400);

    const noTerms = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email: 'noterms@example.bz', password: 'CustomerPass123', firstName: 'A', lastName: 'B' });
    expect(noTerms.status).toBe(400);
  });

  it('ignores injected privileged fields (mass-assignment protection)', async () => {
    const res = await request(ctx.server).post('/api/auth/register').send({
      email: 'inject@example.bz',
      password: 'CustomerPass123',
      firstName: 'In',
      lastName: 'Ject',
      acceptedTerms: true,
      status: 'SUSPENDED',
      activeRoleCode: 'SUPER_ADMIN',
      roles: [{ roleCode: 'ADMIN', status: 'APPROVED' }],
    });
    expect(res.status).toBe(201);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'inject@example.bz' },
      include: { roles: true },
    });
    expect(user.status).toBe('ACTIVE');
    expect(user.roles.map((r) => r.roleCode).sort()).toEqual(['CUSTOMER']);
  });
});

describe('email verification', () => {
  it('verifies via the token delivered to the (dev) inbox', async () => {
    const email = 'verify@example.bz';
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'V', lastName: 'E', acceptedTerms: true });

    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
    expect(inbox.status).toBe(200);
    const token = tokenFromBody(inbox.body.body);
    expect(token).toBeTruthy();

    const verify = await request(ctx.server).post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(201);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();

    // A reused verification token is rejected.
    const again = await request(ctx.server).post('/api/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
  });
});

describe('login, refresh rotation, reuse rejection, logout', () => {
  const email = 'session@example.bz';
  const password = 'CustomerPass123';

  beforeAll(async () => {
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password, firstName: 'S', lastName: 'N', acceptedTerms: true });
  });

  it('logs in and returns auth cookies', async () => {
    const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(201);
    expect(cookieValue(cookiesOf(res), 'access_token')).toBeTruthy();
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const login = await request(ctx.server).post('/api/auth/login').send({ email, password });
    const firstRefresh = cookieValue(cookiesOf(login), 'refresh_token')!;
    expect(firstRefresh).toBeTruthy();

    const rotate = await request(ctx.server)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${firstRefresh}`]);
    expect(rotate.status).toBe(201);
    const secondRefresh = cookieValue(cookiesOf(rotate), 'refresh_token')!;
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh); // rotated

    // Reusing the ORIGINAL refresh token must now fail.
    const reuse = await request(ctx.server)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${firstRefresh}`]);
    expect(reuse.status).toBe(401);
  });

  it('logs out and revokes the session (access token no longer works)', async () => {
    const login = await request(ctx.server).post('/api/auth/login').send({ email, password });
    const cookies = cookiesOf(login);
    const access = cookieValue(cookies, 'access_token')!;

    const me = await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`]);
    expect(me.status).toBe(200);

    const logout = await request(ctx.server).post('/api/auth/logout').set('Cookie', cookies);
    expect(logout.status).toBe(201);

    // Same (still time-valid) access token is now rejected because the session is revoked.
    const after = await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`]);
    expect(after.status).toBe(401);
  });
});

describe('password reset', () => {
  it('resets the password; old password fails, new password works', async () => {
    const email = 'reset@example.bz';
    const oldPassword = 'OldPass12345';
    const newPassword = 'NewPass67890';
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: oldPassword, firstName: 'R', lastName: 'P', acceptedTerms: true });

    await request(ctx.server).post('/api/auth/forgot-password').send({ email });
    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
    const token = tokenFromBody(inbox.body.body);
    expect(token).toBeTruthy();

    const reset = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token, password: newPassword });
    expect(reset.status).toBe(201);

    const oldLogin = await request(ctx.server).post('/api/auth/login').send({ email, password: oldPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(ctx.server).post('/api/auth/login').send({ email, password: newPassword });
    expect(newLogin.status).toBe(201);
  });

  /** Register a user and get back a live reset token for them. */
  async function issueResetToken(email: string, password = 'StartPass12345') {
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password, firstName: 'R', lastName: 'P', acceptedTerms: true });
    await request(ctx.server).post('/api/auth/forgot-password').send({ email });
    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
    const token = tokenFromBody(inbox.body.body);
    expect(token).toBeTruthy();
    return token as string;
  }

  it('will not spend the same reset link twice', async () => {
    const email = 'reset-once@example.bz';
    const token = await issueResetToken(email);

    const first = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'FirstNew12345' });
    expect(first.status).toBe(201);

    // The same link again, as it would be if the mail were forwarded, the page
    // refreshed, or the link found later in an inbox.
    const second = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'AttackerPass12345' });
    expect(second.status).toBe(400);

    // The second attempt must not have moved the password.
    const stillFirst = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email, password: 'FirstNew12345' });
    expect(stillFirst.status).toBe(201);
    const attacker = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email, password: 'AttackerPass12345' });
    expect(attacker.status).toBe(401);
  });

  // Honest scope: this guards the invariant, it does not demonstrate the race.
  // It passes against the pre-fix code too — two supertest requests fired
  // together did not reliably interleave their pre-transaction reads here, so
  // the window this asserts against is one the harness could not open on
  // demand. Treat a failure as a real regression; do not treat the pass as
  // evidence that concurrent reset is exercised.
  it('lets only one of two simultaneous uses of a link win', async () => {
    const email = 'reset-race@example.bz';
    const token = await issueResetToken(email);

    const [a, b] = await Promise.all([
      request(ctx.server).post('/api/auth/reset-password').send({ token, password: 'RacerAAA12345' }),
      request(ctx.server).post('/api/auth/reset-password').send({ token, password: 'RacerBBB12345' }),
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 400]);

    // Exactly one password works, and it is the one whose request succeeded.
    const winner = a.status === 201 ? 'RacerAAA12345' : 'RacerBBB12345';
    const loser = a.status === 201 ? 'RacerBBB12345' : 'RacerAAA12345';
    expect((await request(ctx.server).post('/api/auth/login').send({ email, password: winner })).status).toBe(201);
    expect((await request(ctx.server).post('/api/auth/login').send({ email, password: loser })).status).toBe(401);
  });

  it('rejects a reset link that has expired', async () => {
    const email = 'reset-stale@example.bz';
    const token = await issueResetToken(email, 'StalePass12345');

    // Age the token rather than waiting out the real TTL.
    await ctx.prisma.passwordResetToken.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'TooLate12345' });
    expect(res.status).toBe(400);
    expect((await request(ctx.server).post('/api/auth/login').send({ email, password: 'StalePass12345' })).status).toBe(201);
  });

  it('signs out everywhere when the password is reset', async () => {
    const email = 'reset-sessions@example.bz';
    const password = 'SessionPass12345';
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password, firstName: 'S', lastName: 'R', acceptedTerms: true });
    const access = cookieValue(cookiesOf(reg), 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`])).status).toBe(200);

    await request(ctx.server).post('/api/auth/forgot-password').send({ email });
    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
    const token = tokenFromBody(inbox.body.body);
    const reset = await request(ctx.server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'RotatedPass12345' });
    expect(reset.status).toBe(201);

    // A still time-valid access token must stop working, because the reset
    // revoked every session behind it.
    const after = await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`]);
    expect(after.status).toBe(401);
  });
});
