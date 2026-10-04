/**
 * The role switcher must never activate a role the user does not actually hold
 * as APPROVED. A PENDING or REJECTED application is not a role the user
 * possesses, so switching to it must be refused by the endpoint itself, and the
 * refusal must leave the active role untouched.
 *
 * Each refusal is asserted on the response AND on the stored state: the active
 * role in the database is unchanged and no ROLE_SWITCHED audit row is written.
 * A control switch to the same role once APPROVED proves the fixture itself can
 * switch, so the refusals are not an artefact of a broken setup.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerVerifiedCustomer() {
  const email = `rsb_${uniq()}@example.com`;
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'R', lastName: 'S', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await ctx.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function holdVendorRole(userId: string, status: 'PENDING' | 'REJECTED' | 'APPROVED') {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status, approvedAt: status === 'APPROVED' ? new Date() : null },
    update: { status, approvedAt: status === 'APPROVED' ? new Date() : null },
  });
}

async function activeRoleOf(userId: string) {
  return (await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { activeRoleCode: true } })).activeRoleCode;
}

async function switchedAuditRows(userId: string) {
  return ctx.prisma.auditLog.count({ where: { action: 'ROLE_SWITCHED', actorId: userId } });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.auditLog.deleteMany({ where: { action: 'ROLE_SWITCHED' } });
});

describe('the role switcher refuses a role the user does not hold as APPROVED', () => {
  it('control: the same switch succeeds once the VENDOR role is APPROVED', async () => {
    const u = await registerVerifiedCustomer();
    await holdVendorRole(u.userId, 'APPROVED');

    const sw = await post(u.cookies, 'roles/switch', { roleCode: 'VENDOR' });
    expect(sw.status).toBe(201);
    expect(sw.body.activeRole).toBe('VENDOR');
    expect(await activeRoleOf(u.userId)).toBe('VENDOR');
  });

  it('refuses a PENDING role with 403, and the active role does not change', async () => {
    const u = await registerVerifiedCustomer();
    await holdVendorRole(u.userId, 'PENDING');
    const before = await activeRoleOf(u.userId);

    const sw = await post(u.cookies, 'roles/switch', { roleCode: 'VENDOR' });
    expect(sw.status).toBe(403);
    expect(await activeRoleOf(u.userId)).toBe(before);
    expect(await switchedAuditRows(u.userId)).toBe(0);
  });

  it('refuses a REJECTED role with 403, and the active role does not change', async () => {
    const u = await registerVerifiedCustomer();
    await holdVendorRole(u.userId, 'REJECTED');
    const before = await activeRoleOf(u.userId);

    const sw = await post(u.cookies, 'roles/switch', { roleCode: 'VENDOR' });
    expect(sw.status).toBe(403);
    expect(await activeRoleOf(u.userId)).toBe(before);
    expect(await switchedAuditRows(u.userId)).toBe(0);
  });
});
