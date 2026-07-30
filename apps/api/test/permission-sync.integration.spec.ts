/**
 * Super-admin permission synchronization (M8 hardening) — integration vs real Postgres.
 * Verifies syncSuperAdminPermissions grants the complete catalog to every approved
 * SUPER_ADMIN, leaves other admins untouched, is idempotent, and back-fills newly
 * added permissions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, syncSuperAdminPermissions } from '@bmpl/database';
import { PERMISSIONS } from '@bmpl/shared';
import { resetDb, seedRoles } from './helpers';

type U = { id: string };
async function mkUser(email: string, roleCode: 'SUPER_ADMIN' | 'ADMIN'): Promise<U> {
  return prisma.user.create({
    data: {
      email,
      passwordHash: 'seed-hash',
      firstName: 'T',
      lastName: 'U',
      roles: { create: [{ roleCode, status: 'APPROVED', approvedAt: new Date() }] },
    },
    select: { id: true },
  });
}
const grants = async (userId: string) =>
  (await prisma.adminPermissionGrant.findMany({ where: { userId }, select: { permission: true } })).map((g) => g.permission);

let saPartial: U, saEmpty: U, limited: U;

beforeAll(async () => {
  await resetDb(prisma);
  await seedRoles(prisma);
  // A super admin created with only a PARTIAL grant (simulates being bootstrapped
  // before newer permissions existed — the exact production gap we hit).
  saPartial = await mkUser('sa_partial@example.bz', 'SUPER_ADMIN');
  await prisma.adminPermissionGrant.create({ data: { userId: saPartial.id, permission: 'users.read' } });
  // A super admin with NO grants yet.
  saEmpty = await mkUser('sa_empty@example.bz', 'SUPER_ADMIN');
  // A non-super-admin staff account (must be left untouched).
  limited = await mkUser('limited@example.bz', 'ADMIN');
  await prisma.adminPermissionGrant.create({ data: { userId: limited.id, permission: 'users.read' } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('syncSuperAdminPermissions', () => {
  it('grants the complete catalog to every approved super admin', async () => {
    const res = await syncSuperAdminPermissions(prisma, PERMISSIONS);
    expect(res.superAdmins).toBe(2);
    expect(res.permissions).toBe(PERMISSIONS.length);
    for (const u of [saPartial, saEmpty]) {
      expect((await grants(u.id)).sort()).toEqual([...PERMISSIONS].sort());
    }
  });

  it('leaves non-super-admins untouched', async () => {
    expect(await grants(limited.id)).toEqual(['users.read']);
  });

  it('is idempotent — no duplicate grants on re-run', async () => {
    await syncSuperAdminPermissions(prisma, PERMISSIONS);
    expect(await grants(saPartial.id)).toHaveLength(PERMISSIONS.length);
  });

  it('back-fills a newly added permission on the next sync', async () => {
    const extended = [...PERMISSIONS, 'future.capability'];
    const res = await syncSuperAdminPermissions(prisma, extended);
    expect(res.superAdmins).toBe(2);
    const g = await grants(saEmpty.id);
    expect(g).toContain('future.capability');
    expect(g).toHaveLength(extended.length);
    // remove the synthetic permission so it doesn't leak into other specs
    await prisma.adminPermissionGrant.deleteMany({ where: { permission: 'future.capability' } });
  });
});
