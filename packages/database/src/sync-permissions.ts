import type { PrismaClient } from '@prisma/client';

export interface SuperAdminPermissionSync {
  superAdmins: number;
  permissions: number;
  grantsEnsured: number;
}

/**
 * Grant the COMPLETE permission catalog to EVERY approved SUPER_ADMIN.
 *
 * Idempotent (upsert): safe to run on every seed/bootstrap. When a new
 * permission is later added to the catalog, re-running this grants it to all
 * existing super admins without creating duplicates — closing the gap where an
 * admin bootstrapped before a permission existed would never receive it.
 *
 * `permissions` is injected (the caller passes `PERMISSIONS` from `@bmpl/shared`)
 * so this stays a pure data operation with no cross-package coupling.
 */
export async function syncSuperAdminPermissions(
  client: PrismaClient,
  permissions: readonly string[],
): Promise<SuperAdminPermissionSync> {
  const roles = await client.userRole.findMany({
    where: { roleCode: 'SUPER_ADMIN', status: 'APPROVED' },
    select: { userId: true },
  });
  const userIds = [...new Set(roles.map((r) => r.userId))];

  let grantsEnsured = 0;
  for (const userId of userIds) {
    for (const permission of permissions) {
      await client.adminPermissionGrant.upsert({
        where: { userId_permission: { userId, permission } },
        update: {},
        create: { userId, permission },
      });
      grantsEnsured += 1;
    }
  }
  return { superAdmins: userIds.length, permissions: permissions.length, grantsEnsured };
}
