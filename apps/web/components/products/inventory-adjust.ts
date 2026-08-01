/**
 * Pure inventory-adjustment maths shared by the vendor editor UI and its tests.
 *
 * Mobile vendors never type a minus sign — they pick a mode (Add / Remove / Set)
 * and enter a positive quantity; this derives the signed delta the API expects and
 * the resulting on-hand, mirroring the server rule that on-hand can never go below
 * zero and that a zero delta is a no-op.
 */

export type AdjustMode = 'ADD' | 'REMOVE' | 'SET';

export interface AdjustResult {
  /** Signed delta to POST to /inventory/adjust (result − current). */
  delta: number;
  /** Resulting on-hand quantity after applying the adjustment. */
  result: number;
  /** Whether the adjustment is valid to submit. */
  valid: boolean;
  /** Inline validation message when not valid. */
  error?: string;
}

/** Reason code sent with the adjustment for each mode (server enum). */
export function reasonForMode(mode: AdjustMode): 'RESTOCK' | 'CORRECTION' {
  return mode === 'ADD' ? 'RESTOCK' : 'CORRECTION';
}

/**
 * Compute the signed delta + resulting on-hand from a (mode, absolute-qty) form.
 * `qty` is what the vendor typed — always a non-negative whole number. Returns a
 * validation error (never throws) when the input is malformed, a no-op, or would
 * drive on-hand below zero (which the API rejects regardless of backorders).
 */
export function computeInventoryAdjustment(mode: AdjustMode, qty: number, current: number): AdjustResult {
  if (!Number.isInteger(qty) || qty < 0) {
    return { delta: 0, result: current, valid: false, error: 'Enter a whole number.' };
  }
  const result = mode === 'ADD' ? current + qty : mode === 'REMOVE' ? current - qty : qty;
  const delta = result - current;
  if (delta === 0) {
    return { delta, result, valid: false, error: mode === 'SET' ? 'Already at this quantity.' : 'Enter an amount greater than zero.' };
  }
  if (result < 0) {
    return { delta, result, valid: false, error: `Only ${current} in stock — cannot remove ${qty}.` };
  }
  return { delta, result, valid: true };
}
