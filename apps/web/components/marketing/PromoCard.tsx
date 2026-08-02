'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { PromotionPlacementType } from '@bmpl/shared';
import {
  marketingApi,
  pickDisplayAsset,
  promoHref,
  formatBZD,
  type ServeCard,
} from '../../lib/marketing';
import { ReportPromoDialog } from './ReportPromoDialog';

/**
 * A single sponsored promotion card. Renders the best display asset, the promotion's
 * title/subtitle, an optional price (product/property targets), and is VISIBLY marked
 * "Sponsored". Fires a best-effort impression on mount and a click event on activation —
 * both fire-and-forget so they never block navigation. Additive only: this never affects
 * organic ordering.
 */
export function PromoCard({
  card,
  placement,
  label = 'Sponsored',
}: {
  card: ServeCard;
  placement?: PromotionPlacementType;
  label?: 'Sponsored' | 'Featured';
}) {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    // best-effort impression — swallow every error, never block render.
    void marketingApi.track(card.id, 'impression', placement).catch(() => {});
  }, [card.id, placement]);

  const asset = pickDisplayAsset(card.assets);
  const href = promoHref(card);
  const target = card.target;
  const price =
    target && (target.targetType === 'PRODUCT' || target.targetType === 'PROPERTY') && target.priceMinor != null
      ? formatBZD(target.priceMinor)
      : null;
  const external = !!target?.externalUrl && !target?.href;

  const onClick = () => {
    void marketingApi.track(card.id, 'click', placement).catch(() => {});
  };

  const body = (
    <>
      <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
        {asset?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.altText ?? card.title} className="h-full w-full max-w-full object-cover" />
        ) : (
          'No image'
        )}
        <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-belize-navy/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
          {label}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 font-semibold text-belize-navy group-hover:text-belize-blue">{card.title}</p>
      {card.subtitle && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{card.subtitle}</p>}
      {target?.label && target.targetType !== 'PRODUCT' && target.targetType !== 'PROPERTY' && (
        <p className="mt-1 text-xs text-slate-400">{target.label}</p>
      )}
      {price && <p className="mt-1.5 text-sm font-bold text-belize-navy">{price}</p>}
    </>
  );

  return (
    <div className="relative flex h-full flex-col">
      {href ? (
        external ? (
          <a
            href={href}
            onClick={onClick}
            target="_blank"
            rel="nofollow sponsored noopener noreferrer"
            className="group flex h-full flex-col rounded-bmpl-lg border border-slate-200 bg-white p-3 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md"
          >
            {body}
          </a>
        ) : (
          <Link
            href={href}
            onClick={onClick}
            className="group flex h-full flex-col rounded-bmpl-lg border border-slate-200 bg-white p-3 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md"
          >
            {body}
          </Link>
        )
      ) : (
        <div className="flex h-full flex-col rounded-bmpl-lg border border-slate-200 bg-white p-3 shadow-bmpl-sm">
          {body}
        </div>
      )}
      <div className="mt-2 flex items-center justify-end px-1">
        <ReportPromoDialog promotionId={card.id} />
      </div>
    </div>
  );
}
