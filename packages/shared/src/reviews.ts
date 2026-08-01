/**
 * Reviews & Ratings (Phase 4 · M19) — shared vocabulary + aggregation.
 * Verified reviews only (tied to a completed transaction). Framework-agnostic.
 */

export const REVIEW_SUBJECT_TYPES = ['PRODUCT', 'VENDOR', 'DRIVER'] as const;
export type ReviewSubjectType = (typeof REVIEW_SUBJECT_TYPES)[number];

export const REVIEW_CONTEXT_TYPES = ['ORDER_ITEM', 'VENDOR_ORDER', 'ORDER_DELIVERY'] as const;
export type ReviewContextType = (typeof REVIEW_CONTEXT_TYPES)[number];

export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_REPORT_REASONS = ['SPAM', 'HARASSMENT', 'IRRELEVANT', 'PROHIBITED', 'PRIVACY', 'FRAUDULENT'] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const REVIEW_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export type ReviewReportStatus = (typeof REVIEW_REPORT_STATUSES)[number];

export const REVIEW_MIN_RATING = 1;
export const REVIEW_MAX_RATING = 5;
export const isValidRating = (r: number): boolean => Number.isInteger(r) && r >= REVIEW_MIN_RATING && r <= REVIEW_MAX_RATING;

export const MAX_REVIEW_MEDIA = 5;

export interface RatingAggregate {
  average: number; // rounded to 2 dp
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Recompute an aggregate from raw published ratings (source of truth). */
export function aggregateRatings(ratings: number[]): RatingAggregate {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of ratings) {
    if (!isValidRating(r)) continue;
    distribution[r as 1 | 2 | 3 | 4 | 5] += 1;
    sum += r;
  }
  const count = ratings.length;
  return { average: count ? Math.round((sum / count) * 100) / 100 : 0, count, distribution };
}
