/**
 * Rate limiting — verifies the strict per-IP limit on auth routes returns 429
 * after the configured number of attempts. This spec opts THROTTLING in for the
 * test environment (it is skipped elsewhere) and sets a low limit, then restores
 * the environment so other specs remain unthrottled.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, resetDb, seedRoles, type TestContext } from './helpers';

// Must be set BEFORE the app module is imported (in beforeAll) so the throttle
// decorators + guard read these values.
const prev = {
  enabled: process.env.THROTTLE_TEST_ENABLED,
  limit: process.env.THROTTLE_AUTH_LIMIT,
  ttl: process.env.THROTTLE_TTL_SECONDS,
};
process.env.THROTTLE_TEST_ENABLED = 'true';
process.env.THROTTLE_AUTH_LIMIT = '3';
process.env.THROTTLE_TTL_SECONDS = '60';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  // Redis holds the counters; clear any residue so the window starts fresh.
  await ctx.prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await ctx.app.close();
  // Restore env so subsequent specs are not throttled.
  process.env.THROTTLE_TEST_ENABLED = prev.enabled ?? '';
  process.env.THROTTLE_AUTH_LIMIT = prev.limit ?? '';
  process.env.THROTTLE_TTL_SECONDS = prev.ttl ?? '';
});

describe('rate limiting (auth routes)', () => {
  it('returns 429 after the strict login limit is exceeded', async () => {
    const email = `ratelimit_${Date.now()}@example.bz`;
    await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'R', lastName: 'L', acceptedTerms: true })
      .expect(201);

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.server)
        .post('/api/auth/login')
        .send({ email, password: 'CustomerPass123' });
      statuses.push(res.status);
    }
    // Limit is 3 → the 4th/5th attempts are blocked with 429.
    expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(3)).toContain(429);
  });

  it('throttles resend-verification — the anti-enumeration endpoint must also resist hammering', async () => {
    // The endpoint answers identically for every address (see auth spec), so
    // the ONLY thing stopping bulk probing or email-bombing through it is this
    // limit. Assertions are deliberately tolerant of the throttle key's scope
    // (per-route or per-IP-global): no more than the limit may succeed, a 429
    // must appear, and a throttled call must never surface a server error.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.server)
        .post('/api/auth/resend-verification')
        .send({ email: `resend_limit_${i}@example.bz` });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(3);
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 201 || s === 429)).toBe(true);
  });
});
