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

/**
 * Same rule as {@link visibleRoleGroups}, but a group named in `forceVisible` is
 * shown even without an APPROVED role. For MDF-526: a carrier applicant can hold a
 * `ShippingProviderProfile` (PENDING/REJECTED/SUSPENDED/REVOKED/APPROVED) before the
 * SHIPPING_PROVIDER role itself is approved — two independent lifecycles — and
 * without this, their own pending application is reachable only by a direct URL
 * nobody told them. This module deliberately does not know what a carrier or a
 * profile is; the caller decides which heading to force, from a signal this module
 * has no part of. Declaration order is preserved exactly as `visibleRoleGroups`
 * preserves it — a forced group slots into its normal position, not the end.
 */
export function visibleRoleGroupsWithOverrides<TItem>(
  groups: ReadonlyArray<RoleGatedGroup<TItem>>,
  roles: readonly HeldRole[],
  forceVisible: ReadonlySet<string>,
): Array<RoleGatedGroup<TItem>> {
  const approved = approvedRoles(roles);
  return groups.filter((g) => forceVisible.has(g.heading) || (g.requires.length > 0 && g.requires.some((c) => approved.has(c))));
}
