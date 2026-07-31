/**
 * Payment & wallet-hold vocabulary (Phase 3 · M11 — foundation only).
 *
 * These arrays are the single source of truth for payment status values and
 * MIRROR the Prisma enums. M11 builds the financial ARCHITECTURE only: no money
 * moves, no balances change, no capture/settlement. The state machine is defined
 * here; only the CREATED→PENDING (checkout) and →CANCELLED (release) transitions
 * fire in M11.
 */

/** Payment lifecycle. Terminal-capture states (PAID/CAPTURED/SETTLED/REFUNDED) are NOT defined yet. */
export const PAYMENT_STATUSES = [
  'CREATED', // record created, nothing attempted
  'PENDING', // awaiting processing (M12 gateway/wallet capture)
  'AUTHORIZED', // funds authorized/held by a method (no capture) — reserved for M12
  'FAILED', // authorization failed
  'EXPIRED', // authorization window lapsed
  'CANCELLED', // cancelled before capture (e.g. order/reservation released)
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Allowed payment state transitions. Capture/settlement is deliberately absent. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ['PENDING', 'CANCELLED', 'FAILED', 'EXPIRED'],
  PENDING: ['AUTHORIZED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  AUTHORIZED: ['CANCELLED', 'EXPIRED'], // capture (→PAID) is a later milestone
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
} as const;

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Payment instruments. M11 provisions WALLET only; card/bank are schema-ready. */
export const PAYMENT_METHOD_TYPES = ['WALLET', 'CREDIT_CARD', 'BANK_TRANSFER'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/** A gateway/processing attempt on a payment (foundation table; unused in M11). */
export const PAYMENT_ATTEMPT_STATUSES = ['CREATED', 'PENDING', 'AUTHORIZED', 'FAILED'] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/**
 * Wallet hold lifecycle. `HELD` = soft reservation (M11, no money). `AUTHORIZED`
 * = backed by a real customer→escrow ledger movement (M12). `RELEASED` = released
 * (a soft hold releases with no money; an authorized hold reverses escrow→customer).
 */
export const WALLET_HOLD_STATUSES = ['HELD', 'AUTHORIZED', 'RELEASED'] as const;
export type WalletHoldStatus = (typeof WALLET_HOLD_STATUSES)[number];

/** Append-only payment event-log entry types. */
export const PAYMENT_EVENT_TYPES = [
  'CREATED',
  'STATE_CHANGED',
  'HOLD_CREATED',
  'HOLD_RELEASED',
  'IDEMPOTENT_REPLAY',
] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/** A forward link from a payment to a (future) wallet ledger movement. */
export const LEDGER_REFERENCE_STATUSES = ['PENDING', 'POSTED', 'VOID'] as const;
export type LedgerReferenceStatus = (typeof LEDGER_REFERENCE_STATUSES)[number];

/** Intended purpose of a planned ledger movement. */
export const LEDGER_REFERENCE_PURPOSES = ['CUSTOMER_PAYMENT'] as const;
export type LedgerReferencePurpose = (typeof LEDGER_REFERENCE_PURPOSES)[number];

/** Idempotency-key lifecycle for payment/checkout initiation. */
export const IDEMPOTENCY_KEY_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const;
export type IdempotencyKeyStatus = (typeof IDEMPOTENCY_KEY_STATUSES)[number];
