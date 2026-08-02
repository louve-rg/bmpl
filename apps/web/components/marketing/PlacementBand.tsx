import type { PromotionPlacementType } from '@bmpl/shared';
import { serverGetSafe } from '../../lib/server-api';
import type { ServeCard } from '../../lib/marketing';
import { SponsoredRow } from './SponsoredRow';

/**
 * Generic sponsored band for a single placement, usable on category/search/discovery/
 * marketplace/jobs/real-estate pages. Server-rendered via serverGetSafe (never throws);
 * renders a labelled sponsored row when the placement returns promotions, otherwise
 * nothing. Additive only — it does NOT reorder the organic listings it sits beside.
 */
export async function PlacementBand({
  placement,
  categoryId,
  title = 'Sponsored',
  className = '',
}: {
  placement: PromotionPlacementType;
  categoryId?: string;
  title?: string;
  className?: string;
}) {
  const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : '';
  const res = await serverGetSafe<ServeCard[]>(`/marketing/placements/${placement}${query}`);
  if (!res.ok || res.data.length === 0) return null;

  return (
    <div className={className}>
      <SponsoredRow title={title} items={res.data} placement={placement} />
    </div>
  );
}
