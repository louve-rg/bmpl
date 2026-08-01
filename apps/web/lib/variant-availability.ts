/**
 * Variant availability — the single source of truth shared by the live
 * marketplace product page (ProductView) and the vendor Storefront Preview.
 *
 * Everything here is pure and framework-free so both callers derive identical
 * behaviour (which values are selectable, which variants to show, and what the
 * purchase button should say) from the same code.
 *
 * The API already guarantees that only published + active variants reach the
 * client, so "available" reduces to the stock signal on `availability`.
 */

export interface VariantAvailabilityInfo {
  inStock: boolean;
  lowStock?: boolean;
  outOfStock: boolean;
  available: number | null;
  unlimited: boolean;
  allowBackorders: boolean;
}

export interface VariantLike {
  id: string;
  /** Resolved variant title (displayName → option label → product title). */
  title: string;
  priceMinor: number | null;
  salePriceMinor: number | null;
  optionValueIds: string[];
  availability: VariantAvailabilityInfo;
}

export interface OptionLike {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

export interface ProductLike {
  priceMinor: number;
  salePriceMinor: number | null;
  availability: VariantAvailabilityInfo;
}

/** optionId → selected valueId. An option is in the "All" browsing state when
 *  its entry is absent or an empty string. */
export type Selection = Record<string, string>;

/**
 * Pluralize an option name for its "All X" default/browsing label.
 * Sensible English rules: y→ies (after a consonant), s/x/z/ch/sh→es, else +s.
 */
export function pluralizeOptionLabel(name: string): string {
  const n = name.trim();
  if (!n) return 'All';
  let plural: string;
  if (/[^aeiou]y$/i.test(n)) {
    plural = `${n.slice(0, -1)}ies`;
  } else if (/(s|x|z|ch|sh)$/i.test(n)) {
    plural = `${n}es`;
  } else if (/[a-z0-9]$/i.test(n)) {
    plural = `${n}s`;
  } else {
    // Unusual ending we can't confidently pluralize — fall back verbatim.
    return `All ${n}`;
  }
  return `All ${plural}`;
}

/** A variant is purchasable when it is in stock, unlimited, or backorderable —
 *  all of which the API collapses into `availability.inStock`. */
export function isVariantAvailable(v: VariantLike): boolean {
  return v.availability.inStock;
}

/** The variants to show in the lineup: in-stock only (zero-stock hidden). */
export function availableVariants(variants: VariantLike[]): VariantLike[] {
  return variants.filter(isVariantAvailable);
}

/**
 * Available variants that match the CURRENT selection, by intersection: every
 * option with a specific value chosen must be present on the variant; an option
 * left in the "All" state (empty/absent) simply adds no restriction. This is what
 * the variant lineup shows, so picking one option (e.g. Fragrance: Gingham)
 * immediately narrows the cards to that value only — even while another option
 * (e.g. Size) is still "All".
 */
export function variantsForSelection(variants: VariantLike[], selection: Selection): VariantLike[] {
  const active = Object.values(selection).filter(Boolean);
  return availableVariants(variants).filter((v) => {
    const ids = new Set(v.optionValueIds);
    return active.every((valId) => ids.has(valId));
  });
}

/**
 * Value ids for `optionId` that are backed by at least one AVAILABLE variant
 * given the current selection of the OTHER options (combination-aware). Drives
 * the dropdowns so only reachable, in-stock choices are offered.
 */
export function availableValuesForOption(
  variants: VariantLike[],
  options: OptionLike[],
  selection: Selection,
  optionId: string,
): Set<string> {
  const option = options.find((o) => o.id === optionId);
  const result = new Set<string>();
  if (!option) return result;

  const optionValueIds = new Set(option.values.map((val) => val.id));
  const otherSelected = Object.entries(selection)
    .filter(([oid, vid]) => oid !== optionId && vid)
    .map(([, vid]) => vid);

  for (const v of variants) {
    if (!isVariantAvailable(v)) continue;
    const ids = new Set(v.optionValueIds);
    if (!otherSelected.every((vid) => ids.has(vid))) continue;
    for (const valId of v.optionValueIds) {
      if (optionValueIds.has(valId)) result.add(valId);
    }
  }
  return result;
}

/**
 * The variant whose optionValueIds exactly equal the selected value set — only
 * when every option has a specific value chosen (a variant carries one value
 * per option, so an exact length + membership match implies a full selection).
 */
export function resolveSelectedVariant(
  variants: VariantLike[],
  selection: Selection,
): VariantLike | null {
  const chosen = new Set(Object.values(selection).filter(Boolean));
  if (chosen.size === 0) return null;
  return (
    variants.find(
      (v) => v.optionValueIds.length === chosen.size && v.optionValueIds.every((id) => chosen.has(id)),
    ) ?? null
  );
}

export type PurchaseStateKind = 'UNAVAILABLE' | 'SELECT' | 'ADD' | 'OUT_OF_STOCK';

export interface PurchaseState {
  state: PurchaseStateKind;
  /** The fully-resolved variant (present for ADD/OUT_OF_STOCK), else null. */
  variant: VariantLike | null;
}

/**
 * Overall purchase state for the current selection:
 *  - UNAVAILABLE : no available purchasable variant exists at all
 *  - SELECT      : a valid selection is still required (an option is "All")
 *  - ADD         : a fully-selected, in-stock variant is ready
 *  - OUT_OF_STOCK: the selected variant (or simple product) is out of stock
 */
export function purchaseState(
  product: ProductLike,
  variants: VariantLike[],
  selection: Selection,
): PurchaseState {
  if (variants.length === 0) {
    return { state: product.availability.inStock ? 'ADD' : 'OUT_OF_STOCK', variant: null };
  }
  if (availableVariants(variants).length === 0) {
    return { state: 'UNAVAILABLE', variant: null };
  }
  const variant = resolveSelectedVariant(variants, selection);
  if (!variant) return { state: 'SELECT', variant: null };
  return { state: isVariantAvailable(variant) ? 'ADD' : 'OUT_OF_STOCK', variant };
}

/** Map a variant's optionValueIds back into an option → value selection. */
export function selectionForVariant(options: OptionLike[], variant: VariantLike): Selection {
  const optionOf = new Map<string, string>();
  for (const opt of options) for (const val of opt.values) optionOf.set(val.id, opt.id);
  const next: Selection = {};
  for (const valId of variant.optionValueIds) {
    const oid = optionOf.get(valId);
    if (oid) next[oid] = valId;
  }
  return next;
}

/**
 * Drop any selected values that are no longer backed by an available variant
 * given the rest of the selection. Keeps the dropdowns internally consistent
 * after a change so an invalid combination can never be assembled from the UI.
 */
export function pruneSelection(
  variants: VariantLike[],
  options: OptionLike[],
  selection: Selection,
): Selection {
  const next: Selection = { ...selection };
  for (const opt of options) {
    const val = next[opt.id];
    if (!val) continue;
    if (!availableValuesForOption(variants, options, next, opt.id).has(val)) {
      delete next[opt.id];
    }
  }
  return next;
}
