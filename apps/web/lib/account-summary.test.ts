import { describe, expect, it } from 'vitest';
import { EARNINGS_ROW_CAP, moneyLabel, netSince, startOfToday, startOfWeek } from './account-summary';

const now = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026, local 15:00

const row = (calculatedAt: Date, netMinor: number, status = 'POSTED') => ({
  calculatedAt: calculatedAt.toISOString(),
  netMinor,
  status,
  currency: 'BZD',
});

describe('window starts', () => {
  it('today starts at local midnight; the week starts on the Monday', () => {
    expect(startOfToday(now)).toEqual(new Date(2026, 9, 7));
    expect(startOfWeek(now)).toEqual(new Date(2026, 9, 5));
  });

  it('a Monday is its own week start', () => {
    expect(startOfWeek(new Date(2026, 9, 5, 9))).toEqual(new Date(2026, 9, 5));
  });
});

describe('netSince', () => {
  it('sums only rows inside the window and skips FAILED rows', () => {
    const rows = [
      row(new Date(2026, 9, 7, 9), 1000),
      row(new Date(2026, 9, 7, 8), 500, 'FAILED'),
      row(new Date(2026, 9, 1, 9), 9999),
    ];
    // The list is short (not capped), so the window total is complete.
    expect(netSince(rows, startOfToday(now), EARNINGS_ROW_CAP)).toEqual({ minor: 1000, currency: 'BZD' });
  });

  it('refuses to total a window the capped list may not fully cover', () => {
    const rows = Array.from({ length: EARNINGS_ROW_CAP }, (_, i) => row(new Date(2026, 9, 7, 9, 0, 0, -i), 100));
    // Full list whose oldest row is still today: older rows of today may be missing.
    expect(netSince(rows, startOfToday(now), EARNINGS_ROW_CAP)).toBeNull();
  });

  it('totals a capped list when its oldest row is already before the window', () => {
    const rows = Array.from({ length: EARNINGS_ROW_CAP }, (_, i) => row(new Date(2026, 9, 7, 9 - (i % 2)), 100));
    rows[rows.length - 1] = row(new Date(2026, 8, 1), 100);
    expect(netSince(rows, startOfToday(now), EARNINGS_ROW_CAP)).not.toBeNull();
  });
});

describe('moneyLabel', () => {
  it('formats minor units as dollars with cents, with US$ for USD', () => {
    expect(moneyLabel(12345)).toBe('$123.45');
    expect(moneyLabel(5, 'USD')).toBe('US$0.05');
  });

  it('groups thousands with commas, and changes no digit', () => {
    expect(moneyLabel(99999999999)).toBe('$999,999,999.99');
    expect(moneyLabel(123456)).toBe('$1,234.56');
    expect(moneyLabel(100000)).toBe('$1,000.00');
    expect(moneyLabel(99999)).toBe('$999.99');
    expect(moneyLabel(0)).toBe('$0.00');
    expect(moneyLabel(123456789, 'USD')).toBe('US$1,234,567.89');
  });

  it('keeps the sign where it was', () => {
    expect(moneyLabel(-1250)).toBe('$-12.50');
    expect(moneyLabel(-123456)).toBe('$-1,234.56');
  });
});
