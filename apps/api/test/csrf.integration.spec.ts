/**
 * CSRF protection — double-submit token + Origin allow-list for cookie-based
 * browser requests, with native mobile (Bearer) exempt and non-browser callers
 * (no Origin) unaffected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookieValue, cookiesOf, resetDb, seedRoles, type TestContext } from './helpers';

const ALLOWED_ORIGIN = 'http://localhost:3000';
const EVIL_ORIGIN = 'http://evil.example.com';

let ctx: TestContext;
let cookies: string[];
let csrf: string;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email: 'csrf@example.bz', password: 'CustomerPass123', firstName: 'C', lastName: 'S', acceptedTerms: true });
  cookies = cookiesOf(reg);
  csrf = cookieValue(cookies, 'csrf_token')!;
  expect(csrf).toBeTruthy();
});

afterAll(async () => {
  await ctx.app.close();
});

const switchBody = { roleCode: 'CUSTOMER' };

describe('CSRF protection', () => {
  it('blocks a browser mutation from a DISALLOWED origin', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', cookies)
      .set('Origin', EVIL_ORIGIN)
      .set('x-csrf-token', csrf)
      .send(switchBody);
    expect(res.status).toBe(403);
  });

  it('blocks a browser mutation from an allowed origin WITHOUT the CSRF token', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', cookies)
      .set('Origin', ALLOWED_ORIGIN)
      .send(switchBody);
    expect(res.status).toBe(403);
  });

  it('allows a browser mutation from an allowed origin WITH a matching CSRF token', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', cookies)
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrf)
      .send(switchBody);
    expect(res.status).toBe(201);
  });

  it('normalizes the origin: a trailing-slash / upper-case variant of an allowed origin is accepted', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', cookies)
      .set('Origin', 'HTTP://LOCALHOST:3000/') // cosmetic variant of the allow-listed origin
      .set('x-csrf-token', csrf)
      .send(switchBody);
    expect(res.status).toBe(201);
  });

  it('allows a non-browser request (no Origin) without a CSRF token', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', cookies)
      .send(switchBody);
    expect(res.status).toBe(201);
  });

  it('exempts native mobile (Bearer) requests from browser CSRF', async () => {
    const login = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'csrf@example.bz', password: 'CustomerPass123', fromMobile: true });
    expect(login.status).toBe(201);
    const bearer = login.body.accessToken as string;
    expect(bearer).toBeTruthy();

    const res = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Origin', EVIL_ORIGIN) // would be blocked for a cookie client
      .send(switchBody);
    expect(res.status).toBe(201);
  });
});
