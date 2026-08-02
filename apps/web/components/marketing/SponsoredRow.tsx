import type { ReactNode } from 'react';
import type { PromotionPlacementType } from '@bmpl/shared';
import type { ServeCard } from '../../lib/marketing';
import { PromoCard } from './PromoCard';

/**
 * A titled, clearly-labelled row of sponsored promotion cards. Horizontally scrollable
 * on mobile, a responsive grid on desktop (scrolls within its own container so it never
 * triggers body horizontal scroll). Renders nothing when there are no items — additive
 * only, never a layout gap when empty.
 */
export function SponsoredRow({
  title,
  eyebrow = 'Sponsored',
  cardLabel = 'Sponsored',
  items,
  placement,
  action,
}: {
  title: string;
  eyebrow?: string;
  cardLabel?: 'Sponsored' | 'Featured';
  items: ServeCard[];
  placement?: PromotionPlacementType;
  action?: ReactNode;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section aria-label={`${title} (sponsored)`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="bmpl-eyebrow">{eyebrow}</p>
          <h2 className="text-xl font-bold tracking-tight text-belize-navy sm:text-2xl">{title}</h2>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div
        className="flex gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:pb-0 lg:grid-cols-4"
        role="list"
      >
        {items.map((card) => (
          <div key={card.id} role="listitem" className="w-60 shrink-0 md:w-auto">
            <PromoCard card={card} placement={placement} label={cardLabel} />
          </div>
        ))}
      </div>
    </section>
  );
}
