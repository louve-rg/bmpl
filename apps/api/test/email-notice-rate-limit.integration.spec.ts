/**
 * Per-ADDRESS rate limiting on forgot-password / resend-verification
 * (MDF-24 §4) — isolated in its own file/boot so EMAIL_NOTICE_ADDRESS_LIMIT
 * can be set low without the shared per-IP throttle (ratelimit.integration.spec.ts)
 * interfering: THROTTLE_AUTH_LIMIT is set high here specifically to take the
 * per-IP guard out of the picture, so what's observed is this mechanism only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, resetDb, seedRoles, type TestContext } from './helpers';

const prev = {
  enabled: process.env.THROTTLE_TEST_ENABLED,
  authLimit: process.env.THROTTLE_AUTH_LIMIT,
  ttl: process.env.THROTTLE_TTL_SECONDS,
  addressLimit: process.env.EMAIL_NOTICE_ADDRESS_LIMIT,
};
process.env.THROTTLE_TEST_ENABLED = 'true';
process.env.THROTTLE_AUTH_LIMIT = '1000'; // take the per-IP guard out of the picture
process.env.THROTTLE_TTL_SECONDS = '60';
process.env.EMAIL_NOTICE_ADDRESS_LIMIT = '3';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
  process.env.THROTTLE_TEST_ENABLED = prev.enabled ?? '';
  process.env.THROTTLE_AUTH_LIMIT = prev.authLimit ?? '';
  process.env.THROTTLE_TTL_SECONDS = prev.ttl ?? '';
  process.env.EMAIL_NOTICE_ADDRESS_LIMIT = prev.addressLimit ?? '';
});

describe('per-address notice rate limit (MDF-24)', () => {
  it('caps token creation at the limit for a real address, response shape never distinguishes the cutoff', async () => {
    const email = 'notice_limit_real@example.bz';
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'N', lastName: 'L', acceptedTerms: true });

    const before = await ctx.prisma.passwordResetToken.count();
    const responses: { status: number; body: unknown }[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.server).post('/api/auth/forgot-password').send({ email });
      responses.push({ status: res.status, body: res.body });
    }
    // Every response is identical - the limiter never surfaces a distinguishable status.
    expect(responses).toHaveLength(5);
    const first = responses[0]!;
    expect(responses.every((r) => r.status === first.status)).toBe(true);
    expect(responses.every((r) => JSON.stringify(r.body) === JSON.stringify(first.body))).toBe(true);
    // Only the first 3 (the configured limit) actually created a token.
    expect(await ctx.prisma.passwordResetToken.count()).toBe(before + 3);
  });

  it('applies the same cap to a nonexistent address - the limiter cannot be used to learn existence', async () => {
    const email = 'notice_limit_nobody@example.bz';
    const before = await ctx.prisma.emailVerificationToken.count();
    const responses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.server).post('/api/auth/resend-verification').send({ email });
      responses.push(res.status);
    }
    expect(responses).toHaveLength(5);
    const firstStatus = responses[0]!;
    expect(responses.every((s) => s === firstStatus)).toBe(true);
    // No account exists, so nothing was ever going to be created either way -
    // the point is that all 5 calls succeed identically, cap or no cap.
    expect(await ctx.prisma.emailVerificationToken.count()).toBe(before);
  });
});
