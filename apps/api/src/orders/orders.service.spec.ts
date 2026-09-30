import { describe, expect, it } from 'vitest';
import { allocateProportional } from './orders.service';

describe('allocateProportional (BMPL-351)', () => {
  it('sums exactly to totalMinor, even on a non-evenly-divisible split', () => {
    const shares = allocateProportional(500n, [1n, 1n, 1n]);
    expect(shares.reduce((s, x) => s + x, 0n)).toBe(500n);
    expect(shares.slice().sort((a, b) => Number(a - b))).toEqual([166n, 167n, 167n]);
  });

  it('a single weight takes the whole total', () => {
    expect(allocateProportional(700n, [1n])).toEqual([700n]);
  });

  it('proportional to unequal weights', () => {
    expect(allocateProportional(1000n, [3n, 1n])).toEqual([750n, 250n]);
  });

  it('empty weights returns an empty array, regardless of totalMinor', () => {
    expect(allocateProportional(500n, [])).toEqual([]);
  });

  it('every weight zero AND totalMinor zero — all-zero shares, no leftover to place', () => {
    expect(allocateProportional(0n, [0n, 0n])).toEqual([0n, 0n]);
  });

  it(
    'every weight zero but a REAL total to split — falls back to an equal split rather than ' +
      'dropping the fee (the hardening this test exists to pin): unreachable via the checkout ' +
      'caller today, but the function must never silently return all zeros for a nonzero total',
    () => {
      const shares = allocateProportional(500n, [0n, 0n, 0n]);
      expect(shares.reduce((s, x) => s + x, 0n)).toBe(500n);
      expect(shares.slice().sort((a, b) => Number(a - b))).toEqual([166n, 167n, 167n]);
    },
  );
});
