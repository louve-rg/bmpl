/**
 * /me reports the caller's own admin permissions — the fix for every
 * read-versus-moderate console split. Before this, the frontend could learn a
 * viewer's permissions only by rendering a moderation control and watching it
 * 403: the marketing console, the passenger console, and every future split
 * drew buttons for people who could not press them.
 *
 * The property under test is PARITY: what /me says the caller may do is the
 * same list the PermissionsGuard enforces, because both read the same grant
 * rows (AuthContextService.build and getMe query the identical relation).
 * And it is SELF-ONLY: the endpoint takes no target and reveals nobody else's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function loginOf(email: string, password: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('/me and admin permissions', () => {
  it('a limited admin sees exactly what the guard will let them do — and only their own', async () => {
    const reader = await seedLimitedAdmin(ctx.prisma, `meperm_r_${uniq()}@example.bz`, ['passengers.read']);
    const moderator = await seedLimitedAdmin(ctx.prisma, `meperm_m_${uniq()}@example.bz`, ['passengers.read', 'passengers.moderate']);
    const rc = await loginOf(reader.email, reader.password);
    const mc = await loginOf(moderator.email, moderator.password);

    const readerMe = await get(rc, 'me');
    expect(readerMe.status).toBe(200);
    expect(readerMe.body.adminPermissions).toEqual(['passengers.read']);

    // Self-only: the moderator's extra grant appears in THEIR /me, not the reader's.
    const moderatorMe = await get(mc, 'me');
    expect(moderatorMe.body.adminPermissions).toEqual(['passengers.moderate', 'passengers.read']);

    // PARITY with enforcement, both directions: the permission /me reports
    // works, and the one it omits is refused. A console that renders from
    // this list can no longer draw a button the guard would 403.
    expect((await get(rc, 'admin/passengers/drivers')).status).toBe(200);
    expect((await post(rc, 'admin/passengers/vehicles/nonexistent/approve')).status).toBe(403);
  });

  it('a plain customer gets an empty list, not an absent field', async () => {
    const email = `meperm_c_${uniq()}@example.bz`;
    const reg = await request(ctx.server)
      .post('/api/auth/register')
      .send({ email, password: 'CustomerPass123', firstName: 'M', lastName: 'P', acceptedTerms: true });
    expect(reg.status).toBe(201);
    const me = await get(cookiesOf(reg), 'me');
    expect(me.status).toBe(200);
    // [] not undefined: a console distinguishes "no permissions" from "old API".
    expect(me.body.adminPermissions).toEqual([]);
  });

  it('a super admin sees the same rows the database grants them — parity, not a hardcoded list', async () => {
    const admin = await seedSuperAdmin(ctx.prisma);
    const ac = await loginOf(admin.email, admin.password);
    const me = await get(ac, 'me');
    expect(me.status).toBe(200);
    const granted = (
      await ctx.prisma.adminPermissionGrant.findMany({ where: { userId: me.body.id }, select: { permission: true } })
    ).map((g) => g.permission).sort();
    expect(me.body.adminPermissions).toEqual(granted);
    expect(granted.length).toBeGreaterThan(0);
  });
});
