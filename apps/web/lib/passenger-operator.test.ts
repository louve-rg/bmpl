import { describe, expect, it } from 'vitest';
import { bookingActions, formatBzd, isFareConfigured, tripCancellable } from './passenger-operator';

describe('isFareConfigured — the fare gate, mirrored', () => {
  it('treats null and zero as not a price, exactly as the server does', () => {
    expect(isFareConfigured(null)).toBe(false);
    expect(isFareConfigured(undefined)).toBe(false);
    expect(isFareConfigured(0)).toBe(false);
  });

  it('accepts any positive configured fare', () => {
    expect(isFareConfigured(1)).toBe(true);
    expect(isFareConfigured(700)).toBe(true);
  });
});

describe('formatBzd', () => {
  it('renders minor units verbatim, with no per-seat or per-booking unit invented', () => {
    expect(formatBzd(700)).toBe('BZ$7.00');
    expect(formatBzd(2550)).toBe('BZ$25.50');
    expect(formatBzd(5)).toBe('BZ$0.05');
  });
});

describe('bookingActions', () => {
  it('mirrors the server: confirm only a request, cancel a request or a confirmation', () => {
    expect(bookingActions('REQUESTED')).toEqual(['confirm', 'cancel']);
    expect(bookingActions('CONFIRMED')).toEqual(['cancel']);
    for (const settled of ['COMPLETED', 'CANCELLED', 'EXPIRED', '']) {
      expect(bookingActions(settled)).toEqual([]);
    }
  });
});

describe('tripCancellable', () => {
  it('allows cancelling only a departure that has not begun', () => {
    expect(tripCancellable('SCHEDULED')).toBe(true);
    expect(tripCancellable('ASSIGNED')).toBe(true);
    for (const s of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', '']) {
      expect(tripCancellable(s)).toBe(false);
    }
  });
});
