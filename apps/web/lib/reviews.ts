import { api } from './api';

/** Subjects a review can target. */
export type ReviewSubjectType = 'PRODUCT' | 'VENDOR' | 'DRIVER';

/** Sort options accepted by the public list endpoint (omit for most-recent). */
export type ReviewSort = 'helpful' | 'rating_desc' | 'rating_asc';

/** Report reasons accepted by `POST /reviews/:id/report`. */
export type ReportReason = 'SPAM' | 'HARASSMENT' | 'IRRELEVANT' | 'PROHIBITED' | 'PRIVACY' | 'FRAUDULENT';

export interface ReviewMedia {
  id: string;
  url: string | null;
}

export interface ReviewResponse {
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface Review {
  id: string;
  subjectType: ReviewSubjectType;
  subjectId: string;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  votedHelpful: boolean;
  variantName: string | null;
  sku: string | null;
  media: ReviewMedia[];
  response: ReviewResponse | null;
  isMine: boolean;
  createdAt: string;
  editedAt: string | null;
}

/** 5→1 star distribution, keyed by the string rating value. */
export type RatingDistribution = Record<'1' | '2' | '3' | '4' | '5', number>;

export interface RatingAggregate {
  average: number;
  count: number;
  distribution: RatingDistribution;
}

export interface ReviewListResponse {
  aggregate: RatingAggregate;
  total: number;
  page: number;
  pageSize: number;
  reviews: Review[];
}

/** A subject the signed-in customer is eligible to review. */
export interface EligibleContext {
  subjectType: ReviewSubjectType;
  contextId: string;
  label: string;
  orderNumber: string;
}

/** Labelled report reasons for the inline report picker. */
export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'SPAM', label: 'Spam or advertising' },
  { value: 'HARASSMENT', label: 'Harassment or hate' },
  { value: 'IRRELEVANT', label: 'Off-topic / irrelevant' },
  { value: 'PROHIBITED', label: 'Prohibited content' },
  { value: 'PRIVACY', label: 'Privacy violation' },
  { value: 'FRAUDULENT', label: 'Fake or fraudulent' },
];

/** Human-friendly labels for the sort dropdown. Order matters for rendering. */
export const REVIEW_SORTS: Array<{ value: '' | ReviewSort; label: string }> = [
  { value: '', label: 'Most recent' },
  { value: 'helpful', label: 'Most helpful' },
  { value: 'rating_desc', label: 'Highest rated' },
  { value: 'rating_asc', label: 'Lowest rated' },
];

export const PROFILE_LABELS: Record<ReviewSubjectType, string> = {
  PRODUCT: 'Product',
  VENDOR: 'Vendor',
  DRIVER: 'Driver',
};

export const REVIEW_PAGE_SIZE = 10;

/** Field limits mirrored from the API contract, for client-side validation. */
export const REVIEW_LIMITS = {
  titleMax: 120,
  bodyMax: 4000,
  noteMax: 500,
} as const;

/** Build the public list query string from the current controls. */
export function buildReviewQuery(opts: { sort?: '' | ReviewSort; rating?: number | null; page?: number }): string {
  const params = new URLSearchParams();
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.rating) params.set('rating', String(opts.rating));
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Fetch a page of public reviews for a subject. */
export function fetchSubjectReviews(
  subjectType: ReviewSubjectType,
  subjectId: string,
  opts: { sort?: '' | ReviewSort; rating?: number | null; page?: number } = {},
): Promise<ReviewListResponse> {
  const query = buildReviewQuery(opts);
  return api.get<ReviewListResponse>(`/marketplace/reviews/${subjectType}/${subjectId}${query}`);
}
