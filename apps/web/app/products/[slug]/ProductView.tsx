'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Gallery, type GalleryImage } from './Gallery';
import { buildGalleryImages } from '../../../lib/gallery';
import { Badge } from '../../../components/ui';
import { ProductReviews } from '../../../components/reviews/ProductReviews';
import { StarRating } from '../../../components/reviews/StarRating';
import type { RatingAggregate } from '../../../lib/reviews';
import { VariantLineup, VariantSelector, type LineupImage } from '../../../components/products/VariantChooser';
import { optionValuesFor } from '../../../lib/variant-card';
import { variantDisplay } from '../../../lib/variant-display';
import { formatWeight, formatDimensionsMm } from '@bmpl/shared';
import { cartApi, money, notifyCartChanged } from '../../../lib/cart';
import type { ApiError } from '../../../lib/api';
import { SaveButton } from '../../../components/saved/SaveButton';
import { RecordView } from '../../../components/saved/RecordView';
import { RelatedProducts } from '../../../components/discovery/RelatedProducts';
import {
  presentationVariant,
  purchaseState,
  reconcileSelection,
  selectionForVariant,
  type OptionLike,
  type PurchaseStateKind,
  type Selection,
  type VariantAvailabilityInfo,
  type VariantLike,
} from '../../../lib/variant-availability';

interface Availability extends VariantAvailabilityInfo {}
interface Variant extends VariantLike {
  displayName: string | null;
  optionLabel: string | null;
  sku: string | null;
}
interface Option extends OptionLike {}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  description: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  category: { name: string; slug: string };
  vendor: { businessName: string; slug: string };
  weightGrams: number | null;
  dimensionsMm: { length: number | null; width: number | null; height: number | null };
  tags: string[];
  images: GalleryImage[];
  availability: Availability;
  options: Option[];
  variants: Variant[];
}

/** Effective per-unit stock cap for a selection: null = no cap (unlimited /
 *  backorders / untracked), otherwise the available units. */
function stockCap(a: Availability): number | null {
  if (a.unlimited || a.allowBackorders) return null;
  return a.available == null ? null : Math.max(0, a.available);
}

/** Map the detail images into the shared lineup shape. */
function toLineupImages(images: GalleryImage[]): LineupImage[] {
  return images.map((i) => ({
    variantId: i.variantId ?? null,
    url: i.url,
    altText: i.altText,
    isPrimary: i.isPrimary ?? false,
    position: i.position ?? 0,
  }));
}

export function ProductView({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const hasVariants = product.variants.length > 0;
  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [reviewAggregate, setReviewAggregate] = useState<RatingAggregate | null>(null);

  // The variant to present (image/title/price/SKU/gallery): the exact variant when
  // fully selected, else the single variant matching a partial selection. Derived —
  // never written back into `selection`, so the dropdowns keep their "All" state.
  const selectedVariant = useMemo(
    () => (hasVariants ? (presentationVariant(product.variants, selection) as Variant | null) : null),
    [hasVariants, product.variants, selection],
  );

  const ps = useMemo(
    () => purchaseState(product, product.variants, selection),
    [product, selection],
  );

  // Opening a variant from the lineup is intentional NAVIGATION: push a history entry
  // (?variant=<id>) so the MAIN product page stays behind it. Back then returns to the
  // main product first (and only Back-again leaves to the source page). We optimistically
  // set the selection for instant feedback; the URL-driven effect below is the source of
  // truth and re-affirms it (and drives Back/Forward/swipe-back restores).
  function selectVariant(v: VariantLike) {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v.id);
    window.history.pushState(null, '', url.toString()); // Next 14 shallow routing → syncs useSearchParams
    setSelection(selectionForVariant(product.options, v));
    setQty(1);
  }

  // A dropdown change: the changed option is the anchor (empty = "All"); other
  // selections are kept only if still valid, else reset to "All". Never auto-fills a
  // different option, so the dropdowns can never filter each other into a locked state.
  function changeOption(optionId: string, valueId: string) {
    setSelection((s) => reconcileSelection(product.variants, product.options, s, optionId, valueId));
    setQty(1);
  }

  // The presented variant FOLLOWS the URL (?variant=<id>). Next 14 keeps useSearchParams
  // in sync with BOTH window.history.pushState (a card click, below) AND browser
  // Back/Forward/mobile-swipe-back (popstate). So this single effect restores the full
  // presentation — variant, title, gallery, active thumbnail, price, SKU, inventory,
  // option dropdowns, add-to-cart + wishlist target — on: initial load, a shared link,
  // opening a variant, and stepping Back to the main product ("?variant" removed → the
  // unfiltered "All" state). Dropdown faceting keeps its own local state (it does not
  // change the URL), so this effect only re-runs on a genuine variant navigation.
  const searchParams = useSearchParams();
  const urlVariant = hasVariants ? searchParams.get('variant') : null;
  useEffect(() => {
    if (!hasVariants) return;
    const v = urlVariant ? product.variants.find((x) => x.id === urlVariant) : null;
    setSelection(v ? selectionForVariant(product.options, v) : {});
    setQty(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlVariant]);

  // Shared display model: variant name (primary), remaining option values (secondary,
  // each on its own line), then the base product family — never a slash-combined title,
  // never a repeated option value. For no selection it collapses to the product title.
  const disp = variantDisplay({
    displayName: selectedVariant?.displayName ?? null,
    optionValues: selectedVariant ? optionValuesFor(selectedVariant.optionValueIds, product.options) : [],
    title: selectedVariant?.title ?? null,
    productTitle: product.title,
  });
  const avail: Availability = selectedVariant ? selectedVariant.availability : product.availability;
  const state: PurchaseStateKind = ps.state;
  const cap = selectedVariant ? stockCap(avail) : hasVariants ? null : stockCap(avail);
  const maxQty = cap;

  // Keep the chosen quantity within the current cap (e.g. after switching variant).
  const effectiveQty = maxQty == null ? qty : Math.min(qty, Math.max(1, maxQty));

  const effectivePrice = selectedVariant
    ? selectedVariant.salePriceMinor ?? selectedVariant.priceMinor ?? product.salePriceMinor ?? product.priceMinor
    : product.salePriceMinor ?? product.priceMinor;
  const compareAt = selectedVariant
    ? selectedVariant.salePriceMinor != null
      ? selectedVariant.priceMinor ?? product.priceMinor
      : null
    : product.salePriceMinor != null
      ? product.priceMinor
      : null;

  // Variant-aware gallery. "All" = general images first, then each variant's group in
  // vendor order (grouped, never interleaved); a selected variant = only its images.
  // Shared ordering utility so the Storefront Preview matches exactly. Brand Image is
  // already excluded by the API (listGallery).
  const galleryImages = useMemo(
    () => buildGalleryImages(product.images, product.variants.map((v) => v.id), selectedVariant?.id ?? null),
    [product.images, product.variants, selectedVariant],
  );

  const lineupImages = useMemo(() => toLineupImages(product.images), [product.images]);

  function clampQty(n: number) {
    const lo = 1;
    const hi = maxQty == null ? 100000 : Math.max(1, maxQty);
    setQty(Math.max(lo, Math.min(hi, Math.floor(n) || 1)));
  }

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const cart = await cartApi.add({
        productId: product.id,
        variantId: selectedVariant?.id ?? null,
        quantity: effectiveQty,
      });
      notifyCartChanged(cart.itemCount);
      setMessage({ kind: 'ok', text: 'Added to your cart.' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
        return;
      }
      setMessage({ kind: 'err', text: err.message || 'Could not add to cart.' });
    } finally {
      setBusy(false);
    }
  }

  const canAdd = state === 'ADD' && !busy && (maxQty == null || maxQty >= 1);
  const controlsDisabled = state !== 'ADD';
  const dims = product.dimensionsMm;

  const buttonLabel = busy
    ? 'Adding…'
    : state === 'UNAVAILABLE'
      ? 'Unavailable'
      : state === 'OUT_OF_STOCK'
        ? 'Out of stock'
        : state === 'SELECT'
          ? 'Select options'
          : `Add to cart · ${money(effectivePrice)}`;

  return (
    <>
    <RecordView productId={product.id} />
    <div className="mt-4 grid gap-8 md:grid-cols-2">
      <div>
        {/* key resets the active thumbnail when the shown image set changes */}
        <Gallery key={selectedVariant?.id ?? 'base'} images={galleryImages} />
        {hasVariants && (
          <VariantLineup
            variants={product.variants}
            options={product.options}
            images={lineupImages}
            selection={selection}
            selectedId={selectedVariant?.id ?? null}
            fallbackPriceMinor={product.salePriceMinor ?? product.priceMinor}
            onSelect={selectVariant}
          />
        )}
      </div>

      <div>
        <p className="bmpl-eyebrow">{product.category.name}</p>
        {/* Hierarchy: variant name → remaining option values (own lines) → base product family. */}
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-belize-navy">{disp.primary || product.title}</h1>
        {disp.secondary.map((s) => (
          <p key={s} className="text-sm text-slate-600">{s}</p>
        ))}
        {disp.family && <p className="text-sm text-slate-500">{disp.family}</p>}
        {reviewAggregate && reviewAggregate.count > 0 && (
          <a href="#reviews" className="mt-1.5 inline-flex items-center gap-1.5 hover:underline">
            <StarRating value={reviewAggregate.average} size="sm" showValue count={reviewAggregate.count} />
          </a>
        )}

        <p className="mt-4 text-2xl">
          {compareAt != null ? (
            <>
              <span className="font-bold text-belize-blue">{money(effectivePrice)}</span>{' '}
              <span className="text-lg text-slate-400 line-through">{money(compareAt)}</span>
            </>
          ) : (
            <span className="font-bold text-belize-navy">{money(effectivePrice)}</span>
          )}
          <span className="ml-2 text-sm text-slate-400">{product.currency}</span>
        </p>

        {selectedVariant?.sku && <p className="mt-1 text-xs text-slate-400">SKU: {selectedVariant.sku}</p>}

        <p className="mt-2">
          <StockBadge state={state} avail={avail} />
        </p>

        {/* ---- buy panel ---- */}
        <div className="mt-6 rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm">
          {hasVariants && (
            <VariantSelector
              options={product.options}
              variants={product.variants}
              selection={selection}
              onChange={changeOption}
            />
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <span className="bmpl-label">Quantity</span>
              <div className="inline-flex items-stretch overflow-hidden rounded-bmpl-md border border-slate-300">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  disabled={controlsDisabled || effectiveQty <= 1}
                  onClick={() => clampQty(effectiveQty - 1)}
                  className="px-3 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                >
                  −
                </button>
                <input
                  aria-label="Quantity"
                  type="number"
                  min={1}
                  max={maxQty ?? undefined}
                  value={effectiveQty}
                  disabled={controlsDisabled}
                  onChange={(e) => clampQty(Number(e.target.value))}
                  className="w-14 border-x border-slate-300 text-center text-sm outline-none focus:ring-2 focus:ring-belize-accent/30 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  aria-label="Increase quantity"
                  disabled={controlsDisabled || (maxQty != null && effectiveQty >= maxQty)}
                  onClick={() => clampQty(effectiveQty + 1)}
                  className="px-3 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="flex-1 rounded-bmpl-md bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white shadow-bmpl-sm transition hover:bg-belize-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {buttonLabel}
            </button>

            <SaveButton
              productId={product.id}
              variantId={selectedVariant?.id ?? null}
              hasVariants={hasVariants}
              onNotice={(text) => setMessage({ kind: 'err', text })}
              size="lg"
              className="border border-slate-300 hover:border-belize-blue hover:bg-belize-blue/5"
            />
          </div>

          {state === 'ADD' && maxQty != null && maxQty <= 10 && (
            <p className="mt-2 text-xs font-medium text-amber-600">
              Only {maxQty} left in stock — the quantity is capped at what's available.
            </p>
          )}

          {message && (
            <p role="status" className={`mt-3 text-sm ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
              {message.text}
              {message.kind === 'ok' && (
                <>
                  {' '}
                  <a href="/cart" className="font-semibold text-belize-blue hover:underline">
                    View cart →
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        <p className="mt-3 text-sm text-slate-500">
          Sold by{' '}
          <Link href={`/store/${product.vendor.slug}`} className="font-medium text-belize-blue hover:underline">
            {product.vendor.businessName}
          </Link>
        </p>

        {product.description && <p className="mt-5 whitespace-pre-wrap text-slate-600">{product.description}</p>}

        {(() => {
          // Imperial display (Belize) — canonical values are stored metric and
          // converted here via the shared units helpers.
          const weight = formatWeight(product.weightGrams);
          const dimensions = formatDimensionsMm(dims.length, dims.width, dims.height);
          if (!weight && !dimensions) return null;
          return (
            <dl className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600">
              {weight && (
                <div>
                  <dt className="text-slate-400">Weight</dt>
                  <dd>{weight}</dd>
                </div>
              )}
              {dimensions && (
                <div>
                  <dt className="text-slate-400">Dimensions</dt>
                  <dd>{dimensions}</dd>
                </div>
              )}
            </dl>
          );
        })()}

        {product.tags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {product.tags.map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>

    <section id="reviews" className="mt-12 scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight text-belize-navy">Ratings &amp; reviews</h2>
      <div className="mt-4">
        <ProductReviews productId={product.id} onAggregate={setReviewAggregate} />
      </div>
    </section>

    <RelatedProducts slug={product.slug} vendorName={product.vendor.businessName} />
    </>
  );
}

function StockBadge({ state, avail }: { state: PurchaseStateKind; avail: Availability }) {
  if (state === 'SELECT') return <Badge tone="neutral">Select options</Badge>;
  if (state === 'UNAVAILABLE') return <Badge tone="error">Unavailable</Badge>;
  if (state === 'OUT_OF_STOCK') return <Badge tone="error">Out of stock</Badge>;
  const low = avail.lowStock || (avail.available != null && !avail.unlimited && avail.available <= 5);
  return <Badge tone={low ? 'warning' : 'success'}>{low ? 'Low stock' : 'In stock'}</Badge>;
}
