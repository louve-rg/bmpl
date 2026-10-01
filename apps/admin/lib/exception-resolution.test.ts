import { describe, expect, it } from 'vitest';
import { canPrice, confirmLabel, needsPaymentConfirmation, priceUnavailableMessage } from './exception-resolution';

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

describe('needsPaymentConfirmation (owner Ruling 2, BMPL-343)', () => {
  it('is true for a reroute that increases the charge', () => {
    expect(needsPaymentConfirmation({ available: true, totalMinor: 3000, increasesCharge: true })).toBe(true);
  });

  it('is false for a reroute that does not increase the charge — no dialog for the sake of having one', () => {
    expect(needsPaymentConfirmation({ available: true, totalMinor: 1200, increasesCharge: false })).toBe(false);
  });

  it('is false when there is no real price to compare, even if increasesCharge were somehow set', () => {
    expect(needsPaymentConfirmation({ available: true, totalMinor: 0, increasesCharge: true })).toBe(false);
  });

  it('is false (the safe default) when increasesCharge is entirely absent, as on a return preview', () => {
    expect(needsPaymentConfirmation({ available: true, totalMinor: 1500 })).toBe(false);
  });
});

describe('confirmLabel — the three required paths (BMPL-364 "done means")', () => {
  it('priced path: a return names the real amount it will charge', () => {
    expect(confirmLabel('RETURN', { available: true, totalMinor: 4575 })).toBe('Confirm return — charge $45.75');
  });

  it('priced path: a reroute that increases the charge names the real amount', () => {
    expect(confirmLabel('REROUTE', { available: true, totalMinor: 3200, increasesCharge: true })).toBe('Confirm reroute — charge $32.00');
  });

  it('free-reroute path: a reroute that does not increase the charge still states the price, with no charge wording', () => {
    const label = confirmLabel('REROUTE', { available: true, totalMinor: 1800, increasesCharge: false });
    expect(label).toBe('Confirm reroute — $18.00, no change to what was already paid');
    expect(label).not.toMatch(/charge/i);
  });

  it('PENDING_MANUAL path: an unavailable return never offers a button that would charge nothing', () => {
    expect(confirmLabel('RETURN', { available: false, reason: 'NO_LANE' })).toBe('Record as pending — no charge');
  });

  it('PENDING_MANUAL path: a zero-priced reroute reads the same as unavailable, not as a free success', () => {
    expect(confirmLabel('REROUTE', { available: true, totalMinor: 0, increasesCharge: false })).toBe('Record as pending — no charge');
  });
});
