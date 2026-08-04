'use client';

import { useMemo, useState } from 'react';
import { Badge } from '../ui';
import { Gallery, type GalleryImage } from '../../app/products/[slug]/Gallery';
import { buildGalleryImages } from '../../lib/gallery';
import { VariantLineup, VariantSelector, type LineupImage } from './VariantChooser';
import { money } from '../../lib/cart';
import type { InvRow, Inventory, ManageView, ProductImage } from './types';
import {
  presentationVariant,
  purchaseState,
  reconcileSelection,
  selectionForVariant,
  type ProductLike,
  type PurchaseStateKind,
  type Selection,
  type VariantAvailabilityInfo,
  type VariantLike,
} from '../../lib/variant-availability';

/** Derive the marketplace availability signal from editor inventory + quantity.
 *  A variant with 0 on-hand (and no unlimited/backorders) is out of stock. */
function toAvailability(row: InvRow | undefined, quantity: number): VariantAvailabilityInfo {
  const unlimited = row?.unlimited ?? false;
  const allowBackorders = row?.allowBackorders ?? false;
  const available = unlimited ? null : row?.available ?? quantity;
  const inStock = unlimited || allowBackorders || (available ?? 0) > 0;
  return {
    inStock,
    outOfStock: !inStock,
    available,
    unlimited,
    allowBackorders,
    lowStock: row?.lowStock,
  };
}

/**
 * Read-only storefront preview. Renders the SAME variant lineup + combination-
 * aware dropdowns as the live marketplace product page, via the shared
 * lib/variant-availability + VariantChooser code — no add-to-cart.
 */
export function StorefrontPreview({
  view,
  inventory,
  images,
}: {
  view: ManageView;
  inventory: Inventory;
  images: ProductImage[];
}) {
  const invByVariant = useMemo(
    () => new Map(inventory.variants.map((r) => [r.variantId ?? '', r])),
    [inventory.variants],
  );

  // Only active variants reach the storefront (mirrors the marketplace API).
  const variants: VariantLike[] = useMemo(
    () =>
      view.variants
        .filter((v) => v.isActive)
        .map((v) => ({
          id: v.id,
          title: v.title,
          priceMinor: v.priceMinor,
          salePriceMinor: v.salePriceMinor,
          optionValueIds: v.optionValueIds,
          availability: toAvailability(invByVariant.get(v.id), v.quantity),
        })),
    [view.variants, invByVariant],
  );

  const hasVariants = variants.length > 0;
  const fallbackPriceMinor =
    variants.find((v) => v.priceMinor != null)?.priceMinor ??
    variants[0]?.priceMinor ??
    0;
  const product: ProductLike = {
    priceMinor: fallbackPriceMinor,
    salePriceMinor: null,
    availability: toAvailability(inventory.product, inventory.product.quantity),
  };

  const [selection, setSelection] = useState<Selection>({});

  const selectedVariant = useMemo(
    () => (hasVariants ? presentationVariant(variants, selection) : null),
    [hasVariants, variants, selection],
  );
  const ps = useMemo(() => purchaseState(product, variants, selection), [product, variants, selection]);
  const state: PurchaseStateKind = ps.state;

  const galleryImages: GalleryImage[] = useMemo(() => {
    // Mirror the PUBLIC gallery exactly (see API listGallery):
    //  - exclude the Brand Image (listing-only role),
    //  - a VARIANT product shows ONLY images assigned to an active variant — the
    //    General (not assigned) pool is never public,
    //  - a SIMPLE product (no variants) shows its general (variantId = null) images.
    const activeIds = new Set(variants.map((v) => v.id));
    const mapped: GalleryImage[] = images
      .filter((i) => i.url && !i.isBrandImage && i.role !== 'BRAND')
      .filter((i) => (hasVariants ? i.variantId != null && activeIds.has(i.variantId) : i.variantId == null))
      .map((i) => ({
        id: i.id,
        url: i.url,
        altText: i.altText,
        variantId: i.variantId,
        position: i.position,
        isPrimary: i.isPrimary,
      }));
    return buildGalleryImages(mapped, variants.map((v) => v.id), selectedVariant?.id ?? null);
  }, [images, variants, hasVariants, selectedVariant]);

  const lineupImages: LineupImage[] = useMemo(
    () =>
      images.map((i) => ({
        variantId: i.variantId ?? null,
        url: i.url,
        altText: i.altText,
        isPrimary: i.isPrimary,
        position: i.position,
      })),
    [images],
  );

  function changeOption(optionId: string, valueId: string) {
    setSelection((s) => reconcileSelection(variants, view.options, s, optionId, valueId));
  }

  if (images.filter((i) => i.url).length === 0 && !hasVariants) {
    return <p className="text-sm text-slate-400">Add images to preview the storefront gallery.</p>;
  }

  const displayTitle = selectedVariant ? selectedVariant.title : view.productTitle;
  const effectivePrice = selectedVariant
    ? selectedVariant.salePriceMinor ?? selectedVariant.priceMinor ?? fallbackPriceMinor
    : fallbackPriceMinor;

  return (
    <div className="max-w-md">
      {/* key resets the active thumbnail when the shown image set changes */}
      <Gallery key={selectedVariant?.id ?? 'base'} images={galleryImages} />

      {hasVariants && (
        <VariantLineup
          variants={variants}
          options={view.options}
          images={lineupImages}
          selection={selection}
          selectedId={selectedVariant?.id ?? null}
          fallbackPriceMinor={fallbackPriceMinor}
          onSelect={(v) => setSelection(selectionForVariant(view.options, v))}
        />
      )}

      <div className="mt-4">
        <p className="text-lg font-bold text-belize-navy">{displayTitle}</p>
        {selectedVariant && displayTitle !== view.productTitle && (
          <p className="text-sm text-slate-500">{view.productTitle}</p>
        )}
        <p className="mt-1 text-xl font-bold text-belize-navy">{money(effectivePrice)}</p>
        <p className="mt-2">
          <PreviewBadge state={state} />
        </p>
      </div>

      {hasVariants && (
        <div className="mt-4 space-y-3">
          <VariantSelector
            options={view.options}
            variants={variants}
            selection={selection}
            onChange={changeOption}
            idPrefix="preview-opt"
          />
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Preview only — this mirrors what buyers see. Out-of-stock variants are hidden.
      </p>
    </div>
  );
}

function PreviewBadge({ state }: { state: PurchaseStateKind }) {
  if (state === 'SELECT') return <Badge tone="neutral">Select options</Badge>;
  if (state === 'UNAVAILABLE') return <Badge tone="error">Unavailable</Badge>;
  if (state === 'OUT_OF_STOCK') return <Badge tone="error">Out of stock</Badge>;
  return <Badge tone="success">In stock</Badge>;
}
