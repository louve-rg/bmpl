/**
 * Carrier operational lifecycle (MDF-COURIER, D1/D5) — shared state machine,
 * mirroring `dispatch.ts`'s DELIVERY_ACTIONS exactly: the single source of
 * truth for the statuses, the legal transitions, and which actor may perform
 * each one, so the API enforces it and any UI reads from it rather than
 * re-deriving its own copy (root CLAUDE.md §6 — a second hand-written status
 * list is how two sources for one fact drift apart).
 *
 * This is deliberately NOT the generic role-application/role-suspend
 * mechanism (RoleStatus on UserRole) — that governs whether a PERSON may
 * hold the SHIPPING_PROVIDER role at all, and stays the unchanged entry
 * point (D1b). This governs whether the ORG (ShippingProviderProfile) may
 * be handed work. `assertOperableProvider` (apps/api/src/shipping/
 * provider-eligibility.ts) AND-gates both; neither is derived from the
 * other.
 */

/** Every status a carrier organization's profile can hold. */
export const SHIPPING_PROVIDER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'] as const;
export type ShippingProviderStatus = (typeof SHIPPING_PROVIDER_STATUSES)[number];

/** Who may trigger a transition. */
export type ShippingProviderStatusActor = 'ADMIN' | 'CARRIER';

/**
 * The owner's governing principle (D5): no state may be reachable that only
 * a developer can leave. Every status below has at least one legal outbound
 * action — REJECTED has a carrier-initiated way back (RESUBMIT) as well as
 * an admin one (REOPEN); REVOKED's only way out is ADMIN-initiated
 * (REAPPLY), which is deliberate (a carrier must never un-revoke itself,
 * the one security line this table exists to enforce) but still present —
 * never literally terminal in code, even though it is terminal in practice
 * without an admin's action.
 *
 * THE SECURITY LINE: RESUBMIT is the ONLY self-service action, and it is
 * the only action in this whole table whose `from` is a single status
 * (REJECTED) landing on PENDING — zero operational privilege, so it is not
 * an escalation. There is no CARRIER-actor edge anywhere out of SUSPENDED
 * or REVOKED: not hidden in a UI, simply absent from this table, so a
 * service-layer check that only permits actions this table lists can never
 * be bypassed into un-suspending or un-revoking a carrier from the inside.
 */
export const SHIPPING_PROVIDER_STATUS_ACTIONS = {
  APPROVE: { actor: 'ADMIN', from: ['PENDING'], to: 'APPROVED' },
  REJECT: { actor: 'ADMIN', from: ['PENDING'], to: 'REJECTED' },
  SUSPEND: { actor: 'ADMIN', from: ['APPROVED'], to: 'SUSPENDED' },
  REVOKE: { actor: 'ADMIN', from: ['APPROVED', 'SUSPENDED'], to: 'REVOKED' },
  REINSTATE: { actor: 'ADMIN', from: ['SUSPENDED'], to: 'APPROVED' },
  // Admin may re-open a rejected application without the carrier having to
  // act first — distinct from RESUBMIT below, which the carrier triggers.
  REOPEN: { actor: 'ADMIN', from: ['REJECTED'], to: 'PENDING' },
  // Terminal in practice, never terminal in code: re-apply from scratch,
  // admin only.
  REAPPLY: { actor: 'ADMIN', from: ['REVOKED'], to: 'PENDING' },
  RESUBMIT: { actor: 'CARRIER', from: ['REJECTED'], to: 'PENDING' },
} as const satisfies Record<string, { actor: ShippingProviderStatusActor; from: readonly ShippingProviderStatus[]; to: ShippingProviderStatus }>;

export type ShippingProviderStatusAction = keyof typeof SHIPPING_PROVIDER_STATUS_ACTIONS;

/** Is `action` legal from `current`? */
export function canChangeProviderStatus(action: ShippingProviderStatusAction, current: ShippingProviderStatus): boolean {
  return (SHIPPING_PROVIDER_STATUS_ACTIONS[action].from as readonly ShippingProviderStatus[]).includes(current);
}

/** The status an action moves the profile to. */
export function providerStatusTarget(action: ShippingProviderStatusAction): ShippingProviderStatus {
  return SHIPPING_PROVIDER_STATUS_ACTIONS[action].to;
}

/** Whether `status` carries operational privilege at all — the single
 *  question `assertOperableProvider` asks of this column. */
export function isOperableProviderStatus(status: ShippingProviderStatus): boolean {
  return status === 'APPROVED';
}
