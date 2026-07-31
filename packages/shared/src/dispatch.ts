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
 * Cancellation is allowed ONLY from pre-pickup states — once goods are picked up
 * (PICKUP_CONFIRMED) inventory is finalized and reversal is out of M15 scope
 * (refunds/settlement are explicitly deferred).
 */
export const DELIVERY_ACTIONS = {
  ASSIGN: { actor: 'ADMIN', from: ['PENDING_ASSIGNMENT'], to: 'ASSIGNED' },
  REASSIGN: { actor: 'ADMIN', from: ['ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED'], to: 'ASSIGNED' },
  ACCEPT: { actor: 'DRIVER', from: ['ASSIGNED'], to: 'DRIVER_ACCEPTED' },
  DECLINE: { actor: 'DRIVER', from: ['ASSIGNED'], to: 'DRIVER_DECLINED' },
  CONFIRM_PICKUP: { actor: 'DRIVER', from: ['DRIVER_ACCEPTED'], to: 'PICKUP_CONFIRMED' },
  IN_TRANSIT: { actor: 'DRIVER', from: ['PICKUP_CONFIRMED'], to: 'IN_TRANSIT' },
  ARRIVING: { actor: 'DRIVER', from: ['IN_TRANSIT'], to: 'ARRIVING' },
  DELIVER: { actor: 'DRIVER', from: ['ARRIVING'], to: 'DELIVERED' },
  CANCEL: { actor: 'ADMIN', from: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED'], to: 'CANCELLED' },
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
/** After this many wrong PIN attempts the code locks; an admin override is required. */
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
  CANCELLED: 'Cancelled',
};
