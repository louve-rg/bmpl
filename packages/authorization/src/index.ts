import {
  type Permission,
  type RoleCode,
  type RoleStatus,
  SELECTABLE_ROLE_STATUSES,
} from '@bmpl/shared';

/**
 * Framework-agnostic authorization primitives. These are PURE functions; the
 * NestJS guards call into them, but the real enforcement always happens on the
 * backend with data loaded fresh from the database per request.
 */

export interface AuthzRole {
  roleCode: RoleCode;
  status: RoleStatus;
}

export interface AuthzSubject {
  userId: string;
  roles: AuthzRole[];
  permissions: Permission[];
}

/** A role is usable/selectable only when APPROVED. */
export function hasApprovedRole(subject: AuthzSubject, role: RoleCode): boolean {
  return subject.roles.some((r) => r.roleCode === role && r.status === 'APPROVED');
}

export function hasAnyApprovedRole(subject: AuthzSubject, roles: RoleCode[]): boolean {
  return roles.some((role) => hasApprovedRole(subject, role));
}

export function isRoleSelectable(status: RoleStatus): boolean {
  return SELECTABLE_ROLE_STATUSES.includes(status);
}

export function selectableRoles(subject: AuthzSubject): RoleCode[] {
  return subject.roles.filter((r) => isRoleSelectable(r.status)).map((r) => r.roleCode);
}

export function hasPermission(subject: AuthzSubject, permission: Permission): boolean {
  return subject.permissions.includes(permission);
}

export function hasEveryPermission(subject: AuthzSubject, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(subject, p));
}

/**
 * Guard against self-approval / self-review. An actor must never be able to
 * decide their own role application or moderate their own account.
 */
export function isSelfAction(actorUserId: string, targetUserId: string): boolean {
  return actorUserId === targetUserId;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'FORBIDDEN'
      | 'ROLE_NOT_APPROVED'
      | 'SELF_ACTION'
      | 'PERMISSION_REQUIRED' = 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}
