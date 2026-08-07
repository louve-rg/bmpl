import { describe, expect, it } from 'vitest';
import {
  calculateDriverScore,
  DISPATCH_WEIGHTS,
  FAIRNESS_SATURATION_MINUTES,
  rankDrivers,
  WORKLOAD_SATURATION,
  type DriverCandidate,
} from './dispatch-ranking';

const NOW = new Date('2026-08-07T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

const candidate = (over: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverProfileId: 'drv_a',
  activeDeliveries: 0,
  lastAssignedAt: minutesAgo(FAIRNESS_SATURATION_MINUTES),
  ratingAverage: 5,
  completedDeliveries: 0,
  isLocal: false,
  previouslyOffered: false,
  ...over,
});

describe('calculateDriverScore', () => {
  it('stays within 0–100', () => {
    const best = calculateDriverScore(
      candidate({ isLocal: true, completedDeliveries: 999, activeDeliveries: 0 }),
      NOW,
    );
    const worst = calculateDriverScore(
      candidate({ activeDeliveries: 99, lastAssignedAt: NOW, ratingAverage: 0, isLocal: false }),
      NOW,
    );
    expect(best.score).toBeLessThanOrEqual(100);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(best.score).toBeGreaterThan(worst.score);
  });

  it('scores a saturated driver zero on workload rather than negative', () => {
    const c = calculateDriverScore(candidate({ activeDeliveries: WORKLOAD_SATURATION * 5 }), NOW);
    expect(c.breakdown.workload).toBe(0);
  });

  it('gives a never-assigned driver full fairness so they can win a first job', () => {
    const c = calculateDriverScore(candidate({ lastAssignedAt: null }), NOW);
    expect(c.breakdown.fairness).toBe(DISPATCH_WEIGHTS.fairness);
  });

  it('treats an unrated driver as mid, not bad', () => {
    const unrated = calculateDriverScore(candidate({ ratingAverage: null }), NOW);
    const zeroRated = calculateDriverScore(candidate({ ratingAverage: 0 }), NOW);
    expect(unrated.breakdown.rating).toBeGreaterThan(zeroRated.breakdown.rating);
  });

  it('is deterministic — the same input always scores the same', () => {
    const c = candidate({ completedDeliveries: 7 });
    expect(calculateDriverScore(c, NOW).score).toBe(calculateDriverScore(c, NOW).score);
  });
});

describe('rankDrivers', () => {
  it('prefers the idle driver over the busy one', () => {
    const busy = candidate({ driverProfileId: 'busy', activeDeliveries: 3 });
    const idle = candidate({ driverProfileId: 'idle', activeDeliveries: 0 });
    expect(rankDrivers([busy, idle], NOW)[0]!.driverProfileId).toBe('idle');
  });

  it('does not let a top rating monopolise the queue', () => {
    // The whole point of weighting fairness above rating: a 5-star driver who
    // just got a job must not beat a 3-star driver who has been waiting.
    const star = candidate({
      driverProfileId: 'star',
      ratingAverage: 5,
      lastAssignedAt: NOW,
      activeDeliveries: 1,
    });
    const waiting = candidate({
      driverProfileId: 'waiting',
      ratingAverage: 3,
      lastAssignedAt: minutesAgo(FAIRNESS_SATURATION_MINUTES),
      activeDeliveries: 0,
    });
    expect(rankDrivers([star, waiting], NOW)[0]!.driverProfileId).toBe('waiting');
  });

  it('breaks a rating tie toward the local driver', () => {
    const far = candidate({ driverProfileId: 'far', isLocal: false });
    const local = candidate({ driverProfileId: 'local', isLocal: true });
    expect(rankDrivers([far, local], NOW)[0]!.driverProfileId).toBe('local');
  });

  it('pushes drivers who already passed on this job to the back without dropping them', () => {
    // Kept as a last resort: a delivery nobody accepted first time round should
    // still find someone rather than dead-end waiting for an admin.
    const declined = candidate({
      driverProfileId: 'declined',
      previouslyOffered: true,
      isLocal: true,
      activeDeliveries: 0,
    });
    const fresh = candidate({ driverProfileId: 'fresh', activeDeliveries: 2 });
    const ranked = rankDrivers([declined, fresh], NOW);
    expect(ranked.map((r) => r.driverProfileId)).toEqual(['fresh', 'declined']);
    expect(ranked).toHaveLength(2);
  });

  it('orders identical candidates deterministically instead of at random', () => {
    const a = candidate({ driverProfileId: 'aaa' });
    const b = candidate({ driverProfileId: 'bbb' });
    expect(rankDrivers([b, a], NOW).map((r) => r.driverProfileId)).toEqual(['aaa', 'bbb']);
    expect(rankDrivers([a, b], NOW).map((r) => r.driverProfileId)).toEqual(['aaa', 'bbb']);
  });

  it('returns an empty list for an empty pool rather than throwing', () => {
    expect(rankDrivers([], NOW)).toEqual([]);
  });
});
