import { describe, expect, it } from 'vitest';
import { PROMOTION_PLACEMENTS } from '@bmpl/shared';
import { LIVE_PLACEMENTS, rendersNowhereYet } from './placement-liveness';

/**
 * Characterization of which slots render TODAY. When a band is mounted on a
 * new page, LIVE_PLACEMENTS gains the slot and the second test's list shrinks
 * — that is the intended maintenance signal, not an inconvenience.
 */
describe('placement liveness', () => {
  it('lists only real placement slots', () => {
    for (const key of Object.keys(LIVE_PLACEMENTS)) {
      expect(PROMOTION_PLACEMENTS).toContain(key);
    }
  });

  it('knows which slots render nowhere yet', () => {
    const dark = PROMOTION_PLACEMENTS.filter((p) => rendersNowhereYet(p));
    expect(dark.sort()).toEqual(['BUSINESS_PAGE', 'DISCOVERY', 'JOBS', 'REAL_ESTATE', 'SEARCH'].sort());
  });

  it('every live slot names where the operator would see it', () => {
    for (const where of Object.values(LIVE_PLACEMENTS)) {
      expect(typeof where).toBe('string');
      expect((where as string).length).toBeGreaterThan(3);
    }
  });
});
