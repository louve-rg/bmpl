import {
  PROMOTION_STATUS_LABELS,
  CAMPAIGN_STATUS_LABELS,
  COUPON_STATUS_LABELS,
  type PromotionStatus,
  type CampaignStatus,
  type CouponStatus,
} from '@bmpl/shared';
import { Badge } from '../ui';
import { PROMOTION_STATUS_TONE, CAMPAIGN_STATUS_TONE, COUPON_STATUS_TONE } from './status';

/** Branded chip for a promotion / campaign / coupon status (label + tone). */
export function StatusBadge({
  status,
  kind,
  className = '',
}: {
  status: PromotionStatus | CampaignStatus | CouponStatus;
  kind: 'promotion' | 'campaign' | 'coupon';
  className?: string;
}) {
  if (kind === 'campaign') {
    const s = status as CampaignStatus;
    return (
      <Badge tone={CAMPAIGN_STATUS_TONE[s]} className={className}>
        {CAMPAIGN_STATUS_LABELS[s]}
      </Badge>
    );
  }
  if (kind === 'coupon') {
    const s = status as CouponStatus;
    return (
      <Badge tone={COUPON_STATUS_TONE[s]} className={className}>
        {COUPON_STATUS_LABELS[s]}
      </Badge>
    );
  }
  const s = status as PromotionStatus;
  return (
    <Badge tone={PROMOTION_STATUS_TONE[s]} className={className}>
      {PROMOTION_STATUS_LABELS[s]}
    </Badge>
  );
}
