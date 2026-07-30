import { describe, expect, it } from 'vitest';
import { canTransitionPayment, PAYMENT_STATUSES, PAYMENT_TRANSITIONS } from '@bmpl/shared';

describe('payment state machine (M11)', () => {
  it('allows the checkout + release transitions used in M11', () => {
    expect(canTransitionPayment('CREATED', 'PENDING')).toBe(true); // checkout
    expect(canTransitionPayment('PENDING', 'CANCELLED')).toBe(true); // release
    expect(canTransitionPayment('CREATED', 'CANCELLED')).toBe(true);
  });

  it('does NOT allow capture/settlement transitions (deferred)', () => {
    // No PAID/CAPTURED/SETTLED states exist at all.
    expect(PAYMENT_STATUSES).not.toContain('PAID' as never);
    expect(PAYMENT_STATUSES).not.toContain('CAPTURED' as never);
    // AUTHORIZED cannot advance to a captured state in M11.
    expect(PAYMENT_TRANSITIONS.AUTHORIZED).not.toContain('PENDING');
  });

  it('rejects illegal transitions', () => {
    expect(canTransitionPayment('CREATED', 'AUTHORIZED')).toBe(false); // must go via PENDING
    expect(canTransitionPayment('PENDING', 'CREATED')).toBe(false); // no going back
    expect(canTransitionPayment('CANCELLED', 'PENDING')).toBe(false); // terminal
    expect(canTransitionPayment('FAILED', 'PENDING')).toBe(false); // terminal
    expect(canTransitionPayment('EXPIRED', 'AUTHORIZED')).toBe(false); // terminal
  });

  it('terminal states have no outgoing transitions', () => {
    for (const terminal of ['FAILED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(PAYMENT_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });
});
