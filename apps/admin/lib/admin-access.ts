/**
 * Who may enter the admin console — BMPL-143.
 *
 * The login screen used to prove "admin capability" by probing
 * GET /admin/summary, which requires the users.read permission. That gated
 * the whole console on one data grant: a logistics-scoped admin (real
 * account shape: ADMIN role + logistics.* grants, no users.read) could never
 * get past the login screen, so the entire limited-admin model was
 * unreachable through the UI.
 *
 * The rule (god's ruling): entry gates on IDENTITY, not on a data read.
 * Anyone holding an APPROVED ADMIN role and at least one admin permission
 * may enter; each screen keeps refusing individually, exactly as it already
 * does. The grants come from /me adminPermissions — the same rows the API's
 * PermissionsGuard evaluates (BMPL-47), so what the door admits and what the
 * rooms refuse can never disagree about the facts, only about the scope.
 *
 * Fail closed: an absent field, an empty grant list, or a role that is
 * pending/suspended admits nobody.
 */

export interface MeForAccess {
  roles?: Array<{ roleCode: string; status: string }> | null;
  adminPermissions?: string[] | null;
}

export function canEnterConsole(me: MeForAccess | null | undefined): boolean {
  if (!me) return false;
  const hasAdminRole = (me.roles ?? []).some((r) => r.roleCode === 'ADMIN' && r.status === 'APPROVED');
  const hasAnyGrant = (me.adminPermissions ?? []).length > 0;
  return hasAdminRole && hasAnyGrant;
}

/** The one sentence a refused account reads — unchanged from the old gate. */
export const NO_ADMIN_ACCESS_MESSAGE = 'This account does not have administrator access.';
