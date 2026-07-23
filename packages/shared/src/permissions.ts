/**
 * Admin permission catalog.
 *
 * IMPORTANT: admin permissions are a SEPARATE axis from customer-facing roles.
 * A user's customer roles (VENDOR, DRIVER, ...) never grant any of these. These
 * are held via AdminPermission records and enforced by backend guards.
 */
export const PERMISSIONS = [
  'users.read',
  'users.suspend',
  'users.restore',
  'role_applications.read',
  'role_applications.review', // approve / reject / request-more-info
  'roles.suspend',
  'roles.restore',
  'roles.revoke',
  'documents.read', // view private uploaded documents via signed URLs
  'audit.read',
  'admin.manage', // manage other admins' permissions (SUPER_ADMIN)
  'notifications.broadcast',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Default permission bundles applied when seeding/assigning staff roles. */
export const PERMISSION_BUNDLES: Record<string, Permission[]> = {
  SUPPORT_AGENT: ['users.read', 'role_applications.read', 'documents.read', 'audit.read'],
  ADMIN: [
    'users.read',
    'users.suspend',
    'users.restore',
    'role_applications.read',
    'role_applications.review',
    'roles.suspend',
    'roles.restore',
    'roles.revoke',
    'documents.read',
    'audit.read',
    'notifications.broadcast',
  ],
  SUPER_ADMIN: [...PERMISSIONS],
};
