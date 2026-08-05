'use client';

/**
 * Shared, presentation-only variant UI used by BOTH the live marketplace
 * product page and the vendor Storefront Preview. All availability decisions
 * come from lib/variant-availability so the two views stay identical.
 */
import { money } from '../../lib/cart';
import {
  availableValuesForOption,
  pluralizeOptionLabel,
  variantsForSelection,
  type OptionLike,
  type Selection,
  type VariantLike,
} from '../../lib/variant-availability';
import { variantCardLines } from '../../lib/variant-card';

/** Minimal image shape both callers can map their images into. */
export interface LineupImage {
  variantId: string | null;
  url: string | null;
  altText?: string | null;
  isPrimary: boolean;
  position: number;
}

function variantImage(images: LineupImage[], variantId: string): { url: string; alt: string } | null {
  const forVariant = images
    .filter((i) => i.variantId === variantId && i.url)
    .sort((a, b) => a.position - b.position);
  if (forVariant.length === 0) return null;
  const primary = forVariant.find((i) => i.isPrimary) ?? forVariant[0]!;
  return { url: primary.url!, alt: primary.altText ?? '' };
}

/**
 * Horizontally-scrollable lineup: one card per AVAILABLE variant that matches the
 * current selection (zero-stock hidden), each with the variant's own primary image,
 * title and price. Selecting a specific value for any option immediately narrows the
 * cards to the intersection of all active selections (options left on "All" add no
 * restriction); options are never broadened. Clicking a card selects that variant.
 */
export function VariantLineup({
  variants,
  options,
  images,
  selection,
  selectedId,
  fallbackPriceMinor,
  onSelect,
}: {
  variants: VariantLike[];
  options: OptionLike[];
  images: LineupImage[];
  selection: Selection;
  selectedId: string | null;
  fallbackPriceMinor: number;
  onSelect: (v: VariantLike) => void;
}) {
  const list = variantsForSelection(variants, selection);
  if (list.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="bmpl-label mb-2">
        {list.length} variation{list.length === 1 ? '' : 's'}
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {list.map((v) => {
          const img = variantImage(images, v.id);
          const price = v.salePriceMinor ?? v.priceMinor ?? fallbackPriceMinor;
          const selected = v.id === selectedId;
          const outOfStock = !v.availability.inStock;
          // Primary name (line 1), remaining option values on their own line (line 2),
          // price (line 3). Secondary values are NOT truncated (wrap on narrow cards).
          const lines = variantCardLines(v, options);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v)}
              aria-pressed={selected}
              className={`w-28 shrink-0 rounded-bmpl-md border-2 p-1.5 text-left transition ${
                selected ? 'border-belize-blue shadow-bmpl-sm' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="aspect-square overflow-hidden rounded-bmpl-sm bg-slate-100">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.url}
                    alt={img.alt}
                    className={`h-full w-full object-cover ${outOfStock ? 'opacity-60' : ''}`}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                    No image
                  </div>
                )}
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-belize-navy" title={lines.primary}>
                {lines.primary}
              </p>
              {lines.secondary.length > 0 && (
                <p className="text-[11px] leading-snug text-slate-500">{lines.secondary.join(' · ')}</p>
              )}
              <p className="mt-0.5 text-xs font-medium text-slate-700">{money(price)}</p>
              {outOfStock && (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500">Out of stock</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Combination-aware option dropdowns. Each option defaults to its "All X"
 * browsing label (value "") and only lists values reachable via an available
 * variant given the current selection of the other options.
 */
export function VariantSelector({
  options,
  variants,
  selection,
  onChange,
  idPrefix = 'opt',
}: {
  options: OptionLike[];
  variants: VariantLike[];
  selection: Selection;
  onChange: (optionId: string, valueId: string) => void;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-3">
      {options.map((opt) => {
        const allowed = availableValuesForOption(variants, options, selection, opt.id);
        const id = `${idPrefix}-${opt.id}`;
        return (
          <div key={opt.id}>
            <label htmlFor={id} className="bmpl-label">
              {opt.name}
            </label>
            <select
              id={id}
              value={selection[opt.id] ?? ''}
              onChange={(e) => onChange(opt.id, e.target.value)}
              className="bmpl-input"
            >
              <option value="">{pluralizeOptionLabel(opt.name)}</option>
              {opt.values
                .filter((val) => allowed.has(val.id))
                .map((val) => (
                  <option key={val.id} value={val.id}>
                    {val.value}
                  </option>
                ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
