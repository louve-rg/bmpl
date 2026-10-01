import { describe, expect, it } from 'vitest';
import { canPrice, confirmLabel, priceUnavailableMessage } from './exception-resolution';

describe('canPrice (BMPL-364)', () => {
  it('is true for a real, positive, available price', () => {
    expect(canPrice({ available: true, totalMinor: 2500 })).toBe(true);
  });

  it('is false when the planner could not route it at all', () => {
    expect(canPrice({ available: false, reason: 'NO_LANE', message: 'No configured lane.' })).toBe(false);
  });

  it('is false for a technically-available but zero price — zero is not a price', () => {
    expect(canPrice({ available: true, totalMinor: 0, pricingIncomplete: true })).toBe(false);
  });

  it('is false when totalMinor is entirely absent', () => {
    expect(canPrice({ available: true })).toBe(false);
  });
});

describe('priceUnavailableMessage', () => {
  it('uses the planner message when the route is unavailable', () => {
    expect(priceUnavailableMessage({ available: false, message: 'This leg is still mid-journey.' })).toBe('This leg is still mid-journey.');
  });

  it('falls back to a generic unavailable message when none is given', () => {
    expect(priceUnavailableMessage({ available: false })).toBe('This route cannot be priced yet.');
  });

  it('uses the pricing note for a zero-priced but "available" quote', () => {
    expect(priceUnavailableMessage({ available: true, totalMinor: 0, pricingNote: 'No courier fee is configured for HUB_BZ.' })).toBe(
      'No courier fee is configured for HUB_BZ.',
    );
  });

  it('falls back to a generic message when a zero-priced quote carries no note', () => {
    expect(priceUnavailableMessage({ available: true, totalMinor: 0 })).toBe('This route has not been priced yet.');
  });
});

describe('confirmLabel — the three required paths (BMPL-364/375 "done means"), now preparing rather than charging', () => {
  it('priced path: a return names the real amount, as a preparation, never a charge', () => {
    const label = confirmLabel('RETURN', { available: true, totalMinor: 4575 });
    expect(label).toBe('Prepare return — $45.75');
    expect(label).not.toMatch(/charge/i);
  });

  it('priced path: a reroute that costs more than the original still only ever PREPARES, never charges — BMPL-375 removed the old payment-dialog split entirely', () => {
    const label = confirmLabel('REROUTE', { available: true, totalMinor: 3200, legCostsMoreThanOriginal: true });
    expect(label).toBe('Prepare reroute — $32.00');
    expect(label).not.toMatch(/charge/i);
  });

  it('a reroute that does NOT cost more than the original prepares identically — legCostsMoreThanOriginal never changes the button', () => {
    expect(confirmLabel('REROUTE', { available: true, totalMinor: 1800, legCostsMoreThanOriginal: false })).toBe('Prepare reroute — $18.00');
  });

  it('PENDING_MANUAL path: an unavailable return never offers a button that would charge nothing', () => {
    expect(confirmLabel('RETURN', { available: false, reason: 'NO_LANE' })).toBe('Record as pending — no charge');
  });

  it('PENDING_MANUAL path: a zero-priced reroute reads the same as unavailable, not as a free success', () => {
    expect(confirmLabel('REROUTE', { available: true, totalMinor: 0, legCostsMoreThanOriginal: false })).toBe('Record as pending — no charge');
  });
});
