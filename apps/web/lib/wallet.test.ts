import { describe, expect, it } from 'vitest';
import { bzd } from './wallet';

describe('bzd', () => {
  it('formats minor units as Belize dollars with cents', () => {
    expect(bzd(12345)).toBe('BZ$123.45');
    expect(bzd(0)).toBe('BZ$0.00');
  });

  it('groups thousands with commas, and changes no digit', () => {
    expect(bzd(99999999999)).toBe('BZ$999,999,999.99');
    expect(bzd(123456789)).toBe('BZ$1,234,567.89');
    expect(bzd(100000)).toBe('BZ$1,000.00');
    expect(bzd(99999)).toBe('BZ$999.99');
  });

  it('keeps the sign where it was', () => {
    expect(bzd(-1250)).toBe('BZ$-12.50');
    expect(bzd(-123456)).toBe('BZ$-1,234.56');
  });
});
