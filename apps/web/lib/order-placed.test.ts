import { describe, expect, it } from 'vitest';
import { ORDER_PLACED_MESSAGE } from './order-placed';

describe('ORDER_PLACED_MESSAGE', () => {
  it('is the exact shipped sentence', () => {
    expect(ORDER_PLACED_MESSAGE).toBe('Your items are reserved. This page tracks everything that happens next.');
  });

  it('claims no payment or order state — the status badge owns that truth', () => {
    // The banner shows on every arrival from checkout, paid or unpaid. Any
    // sentence here that asserts payment state is false for one of the two
    // paths — that is exactly the defect this replaced (BMPL-155: "pending…
    // Payment will be added in a later update" shown to a customer who had
    // just paid from their wallet).
    expect(ORDER_PLACED_MESSAGE.toLowerCase()).not.toMatch(/pending|payment|paid|pay\b/);
  });
});
