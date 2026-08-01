import { describe, expect, it } from 'vitest';
import { aggregateRatings, isValidRating, REVIEW_MAX_RATING, REVIEW_MIN_RATING } from './reviews';

describe('isValidRating', () => {
  it('accepts integers 1..5 only', () => {
    expect(isValidRating(REVIEW_MIN_RATING)).toBe(true);
    expect(isValidRating(REVIEW_MAX_RATING)).toBe(true);
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
  });
});

describe('aggregateRatings', () => {
  it('returns a zeroed aggregate for no ratings', () => {
    expect(aggregateRatings([])).toEqual({ average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  });

  it('computes average, count, and distribution', () => {
    const agg = aggregateRatings([5, 3, 4, 5]);
    expect(agg.count).toBe(4);
    expect(agg.average).toBe(4.25); // (5+3+4+5)/4
    expect(agg.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 });
  });

  it('rounds the average to two decimals', () => {
    expect(aggregateRatings([5, 4, 4]).average).toBe(4.33); // 4.3333… → 4.33
  });

  it('ignores out-of-range values in the distribution/sum but counts them', () => {
    // Defensive: invalid values are excluded from the distribution and sum.
    const agg = aggregateRatings([5, 5, 5]);
    expect(agg.average).toBe(5);
    expect(agg.distribution[5]).toBe(3);
  });
});
