/**
 * Driver ranking for automatic dispatch (M26.3 · Part 4).
 *
 * Deliberately PURE and framework-free: no Prisma, no Date.now(), no I/O. The
 * caller loads candidates and passes `now` in. That makes the part of dispatch
 * most likely to be subtly wrong — who gets the job — testable without a
 * database, and keeps the same ranking usable by the API, an admin preview, and
 * any future simulation.
 *
 * Hard eligibility (role approved, licence valid, vehicle approved, serves the
 * district, ONLINE) is NOT decided here. That lives in
 * DriverService.assignmentEligibility and is re-checked at assignment time; this
 * module only orders candidates that already passed it. Two places deciding
 * eligibility is how the two drift apart.
 */

export interface DriverCandidate {
  driverProfileId: string;
  /** Deliveries currently on this driver's plate (assigned/accepted/in transit). */
  activeDeliveries: number;
  /** When this driver was last offered ANY job — drives round-robin fairness. */
  lastAssignedAt: Date | null;
  ratingAverage: number | null;
  completedDeliveries: number;
  /** True when the driver's home district matches the delivery's district. */
  isLocal: boolean;
  /** Already offered this specific delivery and declined, or let it time out. */
  previouslyOffered: boolean;
}

export interface RankedDriver extends DriverCandidate {
  score: number;
  /** Per-component contributions, surfaced so an admin preview can explain a pick. */
  breakdown: Record<string, number>;
}

/**
 * Component weights.
 *
 * Fairness and workload deliberately outweigh rating and experience combined.
 * Rank primarily on rating and the best-rated driver takes every job in their
 * district while everyone else starves — which drives the rest offline and makes
 * the pool worse. Rating is a tie-breaker between drivers who are equally free,
 * not the primary key.
 */
export const DISPATCH_WEIGHTS = {
  workload: 40,
  fairness: 30,
  rating: 15,
  locality: 10,
  experience: 5,
} as const;

/** Workload at or above this is treated as fully loaded (score 0). */
export const WORKLOAD_SATURATION = 3;
/** Waiting longer than this earns the full fairness score. */
export const FAIRNESS_SATURATION_MINUTES = 60;
/** Completed deliveries at or above this earn the full experience score. */
export const EXPERIENCE_SATURATION = 50;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Score a single candidate, 0–100. Higher is a better match.
 *
 * Every component is normalised to 0–1 before weighting, so changing a weight
 * changes only that component's influence and the total stays bounded.
 */
export function calculateDriverScore(candidate: DriverCandidate, now: Date): RankedDriver {
  // Fewer active jobs is better; at saturation the driver contributes nothing here.
  const workload = 1 - clamp01(candidate.activeDeliveries / WORKLOAD_SATURATION);

  // Longer since their last offer is better. A driver who has never been assigned
  // gets the full score — otherwise a new driver can never win their first job.
  const minutesIdle =
    candidate.lastAssignedAt === null
      ? FAIRNESS_SATURATION_MINUTES
      : (now.getTime() - candidate.lastAssignedAt.getTime()) / 60_000;
  const fairness = clamp01(minutesIdle / FAIRNESS_SATURATION_MINUTES);

  // An unrated driver scores mid, not zero: no rating is not a bad rating, and
  // zeroing it would keep new drivers permanently below rated ones.
  const rating = candidate.ratingAverage === null ? 0.5 : clamp01(candidate.ratingAverage / 5);

  const locality = candidate.isLocal ? 1 : 0;
  const experience = clamp01(candidate.completedDeliveries / EXPERIENCE_SATURATION);

  const breakdown = {
    workload: workload * DISPATCH_WEIGHTS.workload,
    fairness: fairness * DISPATCH_WEIGHTS.fairness,
    rating: rating * DISPATCH_WEIGHTS.rating,
    locality: locality * DISPATCH_WEIGHTS.locality,
    experience: experience * DISPATCH_WEIGHTS.experience,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { ...candidate, score, breakdown };
}

/**
 * Rank candidates best-first.
 *
 * Drivers who already saw this delivery and passed on it are pushed to the back
 * rather than dropped, so a delivery is never left unassignable just because
 * everyone declined once — a late retry beats a silent dead end.
 *
 * Ties break on driverProfileId so the order is deterministic. Never random:
 * a reproducible pick is one an admin can be shown and a test can assert.
 */
export function rankDrivers(candidates: readonly DriverCandidate[], now: Date): RankedDriver[] {
  return candidates
    .map((c) => calculateDriverScore(c, now))
    .sort((a, b) => {
      if (a.previouslyOffered !== b.previouslyOffered) return a.previouslyOffered ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      return a.driverProfileId.localeCompare(b.driverProfileId);
    });
}

/** How long a driver has to accept before the offer rolls to the next candidate. */
export const DISPATCH_OFFER_TIMEOUT_SECONDS = 90;
/**
 * Distinct drivers offered before the delivery is escalated to a human. Past this
 * the pool is effectively exhausted and retrying is just delaying the admin alert
 * the customer is waiting on.
 */
export const DISPATCH_MAX_OFFERS = 5;
