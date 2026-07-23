/**
 * Seed idempotency — running the core seed twice must not create duplicates.
 * Uses the same idempotent upsert helpers the real seed script relies on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('seed idempotency', () => {
  it('produces identical row counts on a second run', async () => {
    const snapshot = async () => ({
      roles: await ctx.prisma.role.count(),
      users: await ctx.prisma.user.count(),
      userRoles: await ctx.prisma.userRole.count(),
      permissions: await ctx.prisma.adminPermissionGrant.count(),
      walletAccounts: await ctx.prisma.walletAccount.count(),
    });

    await seedRoles(ctx.prisma);
    await seedSuperAdmin(ctx.prisma);
    const first = await snapshot();

    await seedRoles(ctx.prisma);
    await seedSuperAdmin(ctx.prisma);
    const second = await snapshot();

    expect(second).toEqual(first);
    expect(first.roles).toBe(14);
  });
});
