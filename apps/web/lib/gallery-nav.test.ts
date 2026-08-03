import { describe, expect, it } from 'vitest';
import { swipeDirection, clampIndex, indexAfterSwipe, variantUrlChanged } from './gallery-nav';

describe('gallery swipe + index', () => {
  it('swipe left → next, swipe right → prev, small drag → null', () => {
    expect(swipeDirection(200, 100)).toBe('next'); // moved left 100px
    expect(swipeDirection(100, 200)).toBe('prev'); // moved right 100px
    expect(swipeDirection(100, 120)).toBeNull(); // 20px < threshold
    expect(swipeDirection(null, 100)).toBeNull(); // no start
  });

  it('clamps at the ends (no wrap)', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });

  it('advances/retreats the active index, staying in range', () => {
    expect(indexAfterSwipe(0, 'next', 3)).toBe(1);
    expect(indexAfterSwipe(2, 'next', 3)).toBe(2); // already last
    expect(indexAfterSwipe(0, 'prev', 3)).toBe(0); // already first
    expect(indexAfterSwipe(1, null, 3)).toBe(1);
  });
});

describe('variant URL sync guard (mobile back)', () => {
  it('replaces history only on a real change', () => {
    expect(variantUrlChanged(null, null)).toBe(false); // no variant, none selected → no churn
    expect(variantUrlChanged('v1', 'v1')).toBe(false); // already correct → no churn
    expect(variantUrlChanged(null, 'v1')).toBe(true); // selecting a variant
    expect(variantUrlChanged('v1', 'v2')).toBe(true); // switching variant
    expect(variantUrlChanged('v1', null)).toBe(true); // clearing selection
  });
});
