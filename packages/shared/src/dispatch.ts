/**
 * Dispatch & Delivery Execution (Phase 4 · M15) — shared state machine + constants.
 *
 * The delivery lifecycle is a STRICT state machine. This module is the single
 * source of truth for the statuses, the legal transitions, and which actor may
 * perform each one; the API enforces it (validate current state → validate actor
 * → apply) and the UIs read from it. Framework-agnostic (no Node/Nest imports) so
 * it is shared by API, web, admin, and the future driver mobile app.
 *
 * NO live GPS / route optimization / map ETA / earnings / payouts here — M15 stops
 * at moving one delivery from PENDING_ASSIGNMENT through DELIVERED (+ decline /
 * reassignment / pre-pickup cancellation).
 */

/** Every delivery status. PENDING_ASSIGNMENT is the M13 initial state. */
export const DELIVERY_STATUSES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'DRIVER_ACCEPTED',
  'DRIVER_DECLINED',
  'PICKUP_CONFIRMED',
  'IN_TRANSIT',
  'ARRIVING',
  'DELIVERED',
  // MDF-927: the driver's own report that a job reached PICKUP_CONFIRMED,
  // IN_TRANSIT or ARRIVING and could not be completed (see RAISE_EXCEPTION
  // below). Deliberately NOT in TERMINAL_DELIVERY_STATUSES — it still has a
  // pending fate, it just has no further DRIVER action, only admin CANCEL.
  'EXCEPTION',
  'CANCELLED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Terminal states — no further transitions are legal. */
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['DELIVERED', 'CANCELLED'];

/** Who may trigger a transition. SYSTEM is reserved (unused in M15). */
export type DeliveryActor = 'ADMIN' | 'DRIVER';

/** Lifecycle of a single DeliveryAssignment row (append-only history). */
export const DELIVERY_ASSIGNMENT_STATUSES = [
  'ACTIVE', // the current, outstanding assignment awaiting/holding the driver
  'ACCEPTED', // driver accepted; still the active assignment
  'DECLINED', // driver declined this assignment
  'REASSIGNED', // superseded by a newer assignment (admin reassigned)
  'CANCELLED', // the whole delivery was cancelled while this was active
  'COMPLETED', // the delivery was delivered under this assignment
] as const;
export type DeliveryAssignmentStatus = (typeof DELIVERY_ASSIGNMENT_STATUSES)[number];

/** Verification state for pickup / delivery PIN checks. */
export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'OVERRIDDEN', 'FAILED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The delivery actions and their legal (from → to) edges + required actor.
 *
 * CANCEL's reach was ONLY pre-pickup from M15 through 2026-11-22: once goods
 * were picked up, reversal was out of scope (refunds/settlement explicitly
 * deferred), so there was no edge back off the forward track at all past
 * PICKUP_CONFIRMED — a driver who could not complete a job after pickup, or
 * an admin who needed to stop one, had no legal next action. Superseded,
 * not ignored: the owner directive of 2026-11-22 (MDF-927) names a failed
 * attempt, an exception, a post-dispatch cancellation and a return as
 * required parts of the shipment lifecycle. The fix is ONE new edge, not
 * four: RAISE_EXCEPTION gives the driver a way to report the problem
 * (PICKUP_CONFIRMED/IN_TRANSIT/ARRIVING → EXCEPTION), and CANCEL's `from`
 * gained EXCEPTION as the one way an admin can resolve it — still no
 * refund/escrow/settlement step here, deliberately; that is a separate,
 * owner-level money decision (MDF-927), not state the dispatch edge moves.
 *
 * RAISE_EXCEPTION is written for OrderDelivery (marketplace) only, even
 * though ShipmentLeg.courierStatus shares this exact enum and table. A
 * courier leg already has its own staff/system-driven exception mechanism
 * on ShipmentLeg.status (apps/api/src/shipping/shipment.service.ts) — a
 * second, courierStatus-driven one would be two sources for the same fact.
 * Nothing in apps/api/src/shipping calls RAISE_EXCEPTION; keep it that way
 * unless that leg-side mechanism is reconciled with this one first.
 *
 * TERMINAL BY DESIGN, NOT BY DEFAULT: EXCEPTION has exactly one way out
 * (admin CANCEL) rather than a retry edge back to ASSIGNED, because the
 * existing REASSIGN edge means "re-offer this SAME vendor pickup to a
 * different driver" — correct pre-pickup, wrong once a driver already
 * holds the parcel (the new driver would be told to collect from the
 * vendor, which is no longer where the goods are). A true retry needs a
 * driver-to-driver handoff flow this table does not have yet; that is
 * future scope, not this edge.
 */
export const DELIVERY_ACTIONS = {
  ASSIGN: { actor: 'ADMIN', from: ['PENDING_ASSIGNMENT'], to: 'ASSIGNED' },
  // MDF-18: a driver pulling a delivery automatic dispatch already gave up
  // on (dispatchExhaustedAt set). Same from/to edge as ASSIGN, different
  // actor, but TWO legal `from` statuses, not one: dispatch()'s own
  // dispatchable-status guard treats PENDING_ASSIGNMENT and DRIVER_DECLINED
  // identically ("DRIVER_DECLINED is included deliberately - a decline
  // should roll straight to the next driver"), so markExhausted can commit
  // with EITHER as the delivery's status at that instant - confirmed by the
  // existing exhaustion test (dispatch-engine.integration.spec.ts), which
  // itself accepts both. A narrower `from` here would silently miss exactly
  // the single-offer-timeout case, one of the two ways a delivery actually
  // reaches this state.
  CLAIM: { actor: 'DRIVER', from: ['PENDING_ASSIGNMENT', 'DRIVER_DECLINED'], to: 'ASSIGNED' },
  REASSIGN: { actor: 'ADMIN', from: ['ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED'], to: 'ASSIGNED' },
  ACCEPT: { actor: 'DRIVER', from: ['ASSIGNED'], to: 'DRIVER_ACCEPTED' },
  DECLINE: { actor: 'DRIVER', from: ['ASSIGNED'], to: 'DRIVER_DECLINED' },
  CONFIRM_PICKUP: { actor: 'DRIVER', from: ['DRIVER_ACCEPTED'], to: 'PICKUP_CONFIRMED' },
  IN_TRANSIT: { actor: 'DRIVER', from: ['PICKUP_CONFIRMED'], to: 'IN_TRANSIT' },
  ARRIVING: { actor: 'DRIVER', from: ['IN_TRANSIT'], to: 'ARRIVING' },
  DELIVER: { actor: 'DRIVER', from: ['ARRIVING'], to: 'DELIVERED' },
  // MDF-927: the only edge off the forward track once a job is in the
  // driver's hands. Scoped to marketplace OrderDelivery — see this table's
  // own header comment for why it must not be wired to a courier leg as-is.
  RAISE_EXCEPTION: { actor: 'DRIVER', from: ['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'], to: 'EXCEPTION' },
  CANCEL: { actor: 'ADMIN', from: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED', 'EXCEPTION'], to: 'CANCELLED' },
} as const satisfies Record<string, { actor: DeliveryActor; from: readonly DeliveryStatus[]; to: DeliveryStatus }>;

export type DeliveryAction = keyof typeof DELIVERY_ACTIONS;

/** Is `action` legal from `current`? */
export function canPerform(action: DeliveryAction, current: DeliveryStatus): boolean {
  return (DELIVERY_ACTIONS[action].from as readonly DeliveryStatus[]).includes(current);
}

/** The status an action moves the delivery to. */
export function targetStatus(action: DeliveryAction): DeliveryStatus {
  return DELIVERY_ACTIONS[action].to;
}

export const isTerminalDeliveryStatus = (s: DeliveryStatus): boolean => TERMINAL_DELIVERY_STATUSES.includes(s);

/** PIN configuration for pickup / delivery verification. */
export const DELIVERY_PIN_LENGTH = 4;
/**
 * After this many wrong PIN attempts the code locks; an admin override is
 * required. Also governs ShipmentLeg's handoff AND pickup PINs
 * (shipment.service.ts) — one shared lockout threshold, not two names for
 * the same number. A silent change here is security-relevant; see
 * shipment.service.ts's test coverage, which pins this value.
 */
export const DELIVERY_PIN_MAX_ATTEMPTS = 5;

/** Customer-safe, human-readable status labels (UI convenience). */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING_ASSIGNMENT: 'Awaiting driver',
  ASSIGNED: 'Driver assigned',
  DRIVER_ACCEPTED: 'Driver accepted',
  DRIVER_DECLINED: 'Awaiting reassignment',
  PICKUP_CONFIRMED: 'Picked up',
  IN_TRANSIT: 'On the way',
  ARRIVING: 'Arriving',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Delivery problem reported',
  CANCELLED: 'Cancelled',
};

/**
 * The honest pre-collection stage of a delivery. PENDING_ASSIGNMENT is shown
 * from the moment of checkout, long before anything is dispatchable — its
 * label ("Awaiting driver") told the customer a driver was the hold-up while
 * the store was still packing. The stage names the real gate:
 *
 *  - AWAITING_VENDOR:   the vendor has not marked the order ready.
 *  - AWAITING_DISPATCH: ready, and no driver holds it (fresh or declined).
 *  - OFFERED:           offered to a driver who has not yet accepted.
 *  - null:              a driver accepted, or the delivery is finished —
 *                       DELIVERY_STATUS_LABELS already tells the truth there.
 */
export type DeliveryStage = 'AWAITING_VENDOR' | 'AWAITING_DISPATCH' | 'OFFERED';

export const DELIVERY_STAGE_LABELS: Record<DeliveryStage, string> = {
  AWAITING_VENDOR: 'Being packed by the store',
  AWAITING_DISPATCH: 'Waiting for a driver to be assigned',
  OFFERED: 'Driver offered',
};

/** Derive the stage from facts the delivery row already carries. */
export function deliveryStage(delivery: {
  status: DeliveryStatus;
  readyForDispatchAt: Date | string | null;
}): DeliveryStage | null {
  if (delivery.status === 'PENDING_ASSIGNMENT' || delivery.status === 'DRIVER_DECLINED') {
    return delivery.readyForDispatchAt ? 'AWAITING_DISPATCH' : 'AWAITING_VENDOR';
  }
  if (delivery.status === 'ASSIGNED') return 'OFFERED';
  return null;
}
