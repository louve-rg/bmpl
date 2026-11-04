/**
 * Service-area coverage classification.
 *
 * A driver-worked leg (FIRST_MILE / LAST_MILE / DIRECT) needs somewhere to
 * dispatch it before a customer pays for it. Production has exactly one of
 * Belize's six districts with any configured coverage at all, and inside
 * that one district the figure depends on who happens to be online right
 * now. Those are two DIFFERENT facts and must never collapse into one
 * message: a district with no configured coverage will never be served no
 * matter how long a customer waits, while a configured district with
 * nobody online right now may be served minutes later. Confusing the two
 * either blocks a perfectly bookable order (nobody is online right now, so
 * refuse it) or silently books an order that no change in staffing can ever
 * fulfil (no coverage was ever configured there).
 *
 * Pure and framework-free, matching route-planner.ts's own separation: the
 * caller counts rows (a database concern), this module only classifies
 * counts (a domain-rule concern) so the rule itself is testable without a
 * database and without guessing at — or hard-coding — any district name.
 */
export type ServiceCoverage =
  | { status: 'SUPPORTED' }
  | { status: 'UNSUPPORTED' }
  | { status: 'TEMPORARILY_UNAVAILABLE' };

/**
 * `configuredCount` — drivers who ever declared this district a service
 * area (role approved, profile active, service-area row active),
 * independent of whether any of them happens to be online right now.
 *
 * `eligibleNowCount` — the subset of those also online right now (the same
 * pool `DriverService.eligibleDriversForDistrict` already computes for
 * dispatch). Zero coverage is checked first and independently of the "now"
 * count, so a momentary zero-online reading can never be misreported as
 * "we don't serve this district."
 */
export function classifyDriverLegCoverage(counts: { configuredCount: number; eligibleNowCount: number }): ServiceCoverage {
  if (counts.configuredCount <= 0) return { status: 'UNSUPPORTED' };
  if (counts.eligibleNowCount <= 0) return { status: 'TEMPORARILY_UNAVAILABLE' };
  return { status: 'SUPPORTED' };
}
