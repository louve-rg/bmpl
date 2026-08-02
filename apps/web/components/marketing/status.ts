import type { PromotionStatus, CampaignStatus, CouponStatus } from '@bmpl/shared';
import type { Tone } from '../ui';

/** Branded tone for each promotion status (label + tone, never colour alone). */
export const PROMOTION_STATUS_TONE: Record<PromotionStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  MORE_INFO_REQUIRED: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  PAUSED: 'warning',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
};

/** Branded tone for each campaign status. */
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  RUNNING: 'success',
  PAUSED: 'warning',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
};

/** Branded tone for each coupon status. */
export const COUPON_STATUS_TONE: Record<CouponStatus, Tone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DISABLED: 'error',
};
