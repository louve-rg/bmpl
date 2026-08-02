/**
 * Marketing & Business Promotion (Phase 6 · M26) — shared taxonomy.
 * Single source of truth for promotion/campaign/coupon vocabulary, labels,
 * lifecycle transitions, placement grouping, and limits used by API + web +
 * admin so nothing drifts. Money is ALWAYS BZD minor units. Promotions render
 * as ADDITIVE placements (never mutating organic marketplace/search ranking).
 */

/* ------------------------------------------------------------- promotions */
export const PROMOTION_TYPES = [
  'FEATURED_BUSINESS',
  'FEATURED_STORE',
  'FEATURED_PRODUCT',
  'FEATURED_PROPERTY',
  'FEATURED_JOB',
  'HOMEPAGE_BANNER',
  'CATEGORY_BANNER',
  'ANNOUNCEMENT_BANNER',
  'LIMITED_TIME',
  'COUPON_CAMPAIGN',
  'DISCOUNT_CAMPAIGN',
  'SEASONAL_CAMPAIGN',
  'HOMEPAGE_HERO',
] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];
export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  FEATURED_BUSINESS: 'Featured Business',
  FEATURED_STORE: 'Featured Store',
  FEATURED_PRODUCT: 'Featured Product',
  FEATURED_PROPERTY: 'Featured Property',
  FEATURED_JOB: 'Featured Job',
  HOMEPAGE_BANNER: 'Homepage Banner',
  CATEGORY_BANNER: 'Category Banner',
  ANNOUNCEMENT_BANNER: 'Announcement Banner',
  LIMITED_TIME: 'Limited-Time Promotion',
  COUPON_CAMPAIGN: 'Coupon Campaign',
  DISCOUNT_CAMPAIGN: 'Discount Campaign',
  SEASONAL_CAMPAIGN: 'Seasonal Campaign',
  HOMEPAGE_HERO: 'Homepage Hero',
};

export const PROMOTION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'EXPIRED',
  'ARCHIVED',
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  MORE_INFO_REQUIRED: 'More info required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};
/** Statuses eligible to be shown publicly (still gated by window + isActive + target liveness). */
export const SERVEABLE_PROMOTION_STATUSES: readonly PromotionStatus[] = ['APPROVED'];
/** Statuses in the admin moderation queue. */
export const PROMOTION_MODERATION_QUEUE_STATUSES: readonly PromotionStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

/* -------------------------------------------------------------- targets */
export const PROMOTION_TARGET_TYPES = [
  'VENDOR',
  'EMPLOYER',
  'AGENCY',
  'AGENT',
  'PROPERTY_OWNER',
  'PRODUCT',
  'JOB',
  'PROPERTY',
  'EXTERNAL_LINK',
  'NONE',
] as const;
export type PromotionTargetType = (typeof PROMOTION_TARGET_TYPES)[number];
export const PROMOTION_TARGET_TYPE_LABELS: Record<PromotionTargetType, string> = {
  VENDOR: 'Store / Vendor',
  EMPLOYER: 'Employer',
  AGENCY: 'Agency',
  AGENT: 'Agent',
  PROPERTY_OWNER: 'Property owner',
  PRODUCT: 'Product',
  JOB: 'Job',
  PROPERTY: 'Property',
  EXTERNAL_LINK: 'External link',
  NONE: 'No target',
};

/* ----------------------------------------------------------- placements */
export const PROMOTION_PLACEMENTS = [
  'HOMEPAGE_HERO',
  'HOMEPAGE_FEATURED_BUSINESSES',
  'HOMEPAGE_FEATURED_PRODUCTS',
  'HOMEPAGE_FEATURED_JOBS',
  'HOMEPAGE_FEATURED_PROPERTIES',
  'CATEGORY_PAGE',
  'BUSINESS_PAGE',
  'MARKETPLACE',
  'JOBS',
  'REAL_ESTATE',
  'SEARCH',
  'DISCOVERY',
] as const;
export type PromotionPlacementType = (typeof PROMOTION_PLACEMENTS)[number];
export const PROMOTION_PLACEMENT_LABELS: Record<PromotionPlacementType, string> = {
  HOMEPAGE_HERO: 'Homepage hero',
  HOMEPAGE_FEATURED_BUSINESSES: 'Homepage — featured businesses',
  HOMEPAGE_FEATURED_PRODUCTS: 'Homepage — featured products',
  HOMEPAGE_FEATURED_JOBS: 'Homepage — featured jobs',
  HOMEPAGE_FEATURED_PROPERTIES: 'Homepage — featured properties',
  CATEGORY_PAGE: 'Category page',
  BUSINESS_PAGE: 'Business page',
  MARKETPLACE: 'Marketplace',
  JOBS: 'Jobs',
  REAL_ESTATE: 'Real Estate',
  SEARCH: 'Search results',
  DISCOVERY: 'Discovery',
};
/** Placements that require the `homepage.manage` admin permission to approve/curate. */
export const HOMEPAGE_PLACEMENTS: readonly PromotionPlacementType[] = [
  'HOMEPAGE_HERO',
  'HOMEPAGE_FEATURED_BUSINESSES',
  'HOMEPAGE_FEATURED_PRODUCTS',
  'HOMEPAGE_FEATURED_JOBS',
  'HOMEPAGE_FEATURED_PROPERTIES',
];
/** Placements that carry a category context (categoryId required). */
export const CATEGORY_CONTEXT_PLACEMENTS: readonly PromotionPlacementType[] = ['CATEGORY_PAGE'];

/* --------------------------------------------------------------- assets */
export const PROMOTION_ASSET_KINDS = [
  'DESKTOP_BANNER',
  'MOBILE_BANNER',
  'SQUARE_IMAGE',
  'HERO_IMAGE',
  'LOGO',
  'VIDEO_PLACEHOLDER',
] as const;
export type PromotionAssetKind = (typeof PROMOTION_ASSET_KINDS)[number];
export const PROMOTION_ASSET_KIND_LABELS: Record<PromotionAssetKind, string> = {
  DESKTOP_BANNER: 'Desktop banner',
  MOBILE_BANNER: 'Mobile banner',
  SQUARE_IMAGE: 'Square image',
  HERO_IMAGE: 'Hero image',
  LOGO: 'Logo',
  VIDEO_PLACEHOLDER: 'Video placeholder',
};
/** Asset kinds that carry an uploaded image (vs. VIDEO_PLACEHOLDER which is a URL only). */
export const IMAGE_ASSET_KINDS: readonly PromotionAssetKind[] = [
  'DESKTOP_BANNER',
  'MOBILE_BANNER',
  'SQUARE_IMAGE',
  'HERO_IMAGE',
  'LOGO',
];

/* -------------------------------------------------------------- reports */
export const PROMOTION_REPORT_REASONS = ['MISLEADING', 'INAPPROPRIATE', 'SCAM', 'PROHIBITED', 'IRRELEVANT', 'OTHER'] as const;
export type PromotionReportReason = (typeof PROMOTION_REPORT_REASONS)[number];
export const PROMOTION_REPORT_REASON_LABELS: Record<PromotionReportReason, string> = {
  MISLEADING: 'Misleading',
  INAPPROPRIATE: 'Inappropriate',
  SCAM: 'Scam / fraud',
  PROHIBITED: 'Prohibited content',
  IRRELEVANT: 'Irrelevant',
  OTHER: 'Other',
};
export const PROMOTION_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export type PromotionReportStatus = (typeof PROMOTION_REPORT_STATUSES)[number];

/* ------------------------------------------------------------ campaigns */
export const CAMPAIGN_TYPES = ['SEASONAL', 'LIMITED_TIME', 'SALE', 'COUPON', 'DISCOUNT', 'FEATURED', 'ANNOUNCEMENT'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  SEASONAL: 'Seasonal',
  LIMITED_TIME: 'Limited-time',
  SALE: 'Sale',
  COUPON: 'Coupon',
  DISCOUNT: 'Discount',
  FEATURED: 'Featured',
  ANNOUNCEMENT: 'Announcement',
};

export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'EXPIRED', 'ARCHIVED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};
/** Allowed campaign status transitions (owner + automatic scheduler). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['SCHEDULED', 'ARCHIVED'],
  SCHEDULED: ['RUNNING', 'PAUSED', 'EXPIRED', 'ARCHIVED'],
  RUNNING: ['PAUSED', 'EXPIRED', 'ARCHIVED'],
  PAUSED: ['SCHEDULED', 'RUNNING', 'EXPIRED', 'ARCHIVED'],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};
export const canTransitionCampaign = (from: CampaignStatus, to: CampaignStatus): boolean =>
  (CAMPAIGN_TRANSITIONS[from] ?? []).includes(to);
/** Campaign statuses that are actively serving promotions. */
export const ACTIVE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['RUNNING'];

/* -------------------------------------------------------------- coupons */
export const COUPON_DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];
export const COUPON_DISCOUNT_TYPE_LABELS: Record<CouponDiscountType, string> = {
  PERCENTAGE: 'Percentage off',
  FIXED_AMOUNT: 'Fixed amount off',
};
export const COUPON_SCOPES = ['PLATFORM', 'VENDOR'] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];
export const COUPON_STATUSES = ['ACTIVE', 'INACTIVE', 'DISABLED'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];
export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DISABLED: 'Disabled',
};

/* --------------------------------------------------------------- actions */
/** Admin moderation actions on a promotion. */
export const PROMOTION_MODERATION_ACTIONS = ['APPROVE', 'REJECT', 'REQUEST_INFO', 'PAUSE', 'EXPIRE', 'ARCHIVE', 'RESTORE'] as const;
export type PromotionModerationAction = (typeof PROMOTION_MODERATION_ACTIONS)[number];
/** Owner-initiated status actions on their own promotion. */
export const PROMOTION_OWNER_ACTIONS = ['PAUSE', 'RESUME', 'ARCHIVE'] as const;
export type PromotionOwnerAction = (typeof PROMOTION_OWNER_ACTIONS)[number];

/** Coupon codes: uppercase alphanumerics + dashes, 3–32 chars. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

/* ------------------------------------------------------------- constants */
export const PROMOTIONS_PAGE_SIZE = 20;
export const MAX_PROMOTION_ASSETS = 10;
export const MAX_PROMOTION_TARGETS = 25;
export const DEFAULT_MARKETING_TIMEZONE = 'America/Belize';
export const PROMOTION_SORTS = ['newest', 'priority', 'ending_soon', 'most_viewed'] as const;
export type PromotionSort = (typeof PROMOTION_SORTS)[number];

/** Compute click-through rate (clicks/impressions) as a 0–1 ratio; 0 when no impressions. */
export const computeCtr = (impressions: number, clicks: number): number =>
  impressions > 0 ? clicks / impressions : 0;
