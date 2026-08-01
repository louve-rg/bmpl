import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '../ui';
import { StarRating } from '../reviews/StarRating';
import { SaveButton } from '../saved/SaveButton';
import { money } from '../../lib/cart';

/**
 * Shared shape for a marketplace product card. This is a superset that is
 * satisfied both by the discovery/recommendations `Card` contract and by the
 * catalog list items (whose optional fields — ratings, featured, category slug —
 * may be absent). Rendering degrades gracefully when they are missing.
 */
export interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  brand?: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency?: string;
  featured?: boolean;
  ratingAverage?: number;
  ratingCount?: number;
  category?: { name: string; slug?: string } | null;
  vendor: { businessName: string; slug: string };
  primaryImageUrl: string | null;
  inStock: boolean;
}

/**
 * Reusable, presentational catalog/product card. Matches the existing shop card
 * exactly (image or placeholder, title link, sale-aware price, vendor + category,
 * out-of-stock badge) and adds a star rating when the product has reviews and a
 * SaveButton heart overlay. Safe to render from server or client components.
 */
export function ProductCard({ product: p, className = '' }: { product: ProductCardData; className?: string }) {
  return (
    <div className={`relative h-full ${className}`}>
      <Link
        href={`/products/${p.slug}`}
        className="group flex h-full flex-col rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md"
      >
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
          {p.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full max-w-full object-cover" />
          ) : (
            'No image'
          )}
        </div>
        <p className="mt-3 font-semibold text-belize-navy group-hover:text-belize-blue">{p.title}</p>
        <p className="text-xs text-slate-400">
          {p.vendor.businessName}
          {p.category?.name ? ` · ${p.category.name}` : ''}
        </p>
        {p.ratingCount != null && p.ratingCount > 0 && (
          <StarRating value={p.ratingAverage ?? 0} count={p.ratingCount} size="sm" className="mt-1" />
        )}
        <p className="mt-1.5 text-sm">
          {p.salePriceMinor != null ? (
            <>
              <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
              <span className="text-slate-400 line-through">{money(p.priceMinor)}</span>
            </>
          ) : (
            <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
          )}
        </p>
        {!p.inStock && (
          <Badge tone="error" className="mt-1.5 w-fit">
            Out of stock
          </Badge>
        )}
      </Link>
      <div className="absolute right-6 top-6">
        <SaveButton productId={p.id} className="bg-white/90 shadow-bmpl-sm backdrop-blur hover:bg-white" />
      </div>
    </div>
  );
}

/**
 * A titled row of product cards: horizontally scrollable on mobile, a responsive
 * grid on desktop. Scrolls within its own container so it never triggers body
 * horizontal scroll. Renders nothing when there are no items.
 */
export function ProductRow({
  title,
  eyebrow,
  items,
  action,
}: {
  title: string;
  eyebrow?: string;
  items: ProductCardData[];
  action?: ReactNode;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          {eyebrow && <p className="bmpl-eyebrow">{eyebrow}</p>}
          <h2 className="text-xl font-bold tracking-tight text-belize-navy sm:text-2xl">{title}</h2>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div
        className="flex gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:pb-0 lg:grid-cols-4"
        role="list"
      >
        {items.map((p) => (
          <div key={p.id} role="listitem" className="w-60 shrink-0 md:w-auto">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
