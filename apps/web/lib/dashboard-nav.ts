import type { RoleCode } from '@bmpl/shared';

/**
 * Role gating for the dashboard sidebar.
 *
 * Kept as pure functions (rather than inline in the component) so the rule that
 * decides what a user may see is directly testable — a section leaking to users who
 * do not hold its role is a visible bug, and this is where it would happen.
 */

/** A sidebar section that is only shown to holders of specific roles. */
export interface RoleGatedGroup<TItem> {
  heading: string;
  items: TItem[];
  /**
   * Roles that grant access. Required, never optional: a new section cannot be
   * added without declaring who may see it. Making this optional is exactly how
   * "Belize Connect" and "Real Estate" ended up visible to every user.
   */
  requires: readonly RoleCode[];
}

/** Minimal shape of a role entry on `MeView` (status is a free-form string there). */
export interface HeldRole {
  roleCode: RoleCode;
  status: string;
}

/** The roles a user actually holds — APPROVED only; PENDING/REJECTED/REVOKED do not count. */
export function approvedRoles(roles: readonly HeldRole[]): Set<RoleCode> {
  return new Set(roles.filter((r) => r.status === 'APPROVED').map((r) => r.roleCode));
}

/**
 * The sections a user may see, in declaration order. A group is shown when the user
 * holds ANY of its `requires` roles with status APPROVED; a group requiring no roles
 * is never shown, since an empty requirement is a mistake rather than "everyone".
 */
export function visibleRoleGroups<TItem>(
  groups: ReadonlyArray<RoleGatedGroup<TItem>>,
  roles: readonly HeldRole[],
): Array<RoleGatedGroup<TItem>> {
  const approved = approvedRoles(roles);
  return groups.filter((g) => g.requires.length > 0 && g.requires.some((c) => approved.has(c)));
}
