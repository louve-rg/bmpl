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
  /** The vendor's custom variant name, when set (used as the card's primary line). */
  displayName?: string | null;
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

/** The purchasable (in-stock) subset — used ONLY for purchase-state decisions,
 *  never to build the variation lineup (out-of-stock variants are still shown). */
export function availableVariants(variants: VariantLike[]): VariantLike[] {
  return variants.filter(isVariantAvailable);
}

/**
 * EVERY valid variant that matches the CURRENT selection, by intersection: every
 * option with a specific value chosen must be present on the variant; an option
 * left in the "All" state (empty/absent) simply adds no restriction. This is the
 * source for the variation lineup + the "All" gallery grouping, so it includes
 * OUT-OF-STOCK variants (they render, marked unavailable — never hidden or merged;
 * two variants sharing a display name stay separate because identity is the full
 * option combination). Stock is a display concern handled by each card/button, not
 * a reason to drop a variant. Picking one option (e.g. Type: Sling Bag) narrows the
 * cards to that value while another option (e.g. Size) is still "All".
 */
export function variantsForSelection(variants: VariantLike[], selection: Selection): VariantLike[] {
  const active = Object.values(selection).filter(Boolean);
  return variants.filter((v) => {
    const ids = new Set(v.optionValueIds);
    return active.every((valId) => ids.has(valId));
  });
}

/**
 * Faceted, NON-TRAPPING selection update. The just-changed option is the ANCHOR and
 * is always honoured (an empty value = "All" = the option is cleared). Every OTHER
 * previously-selected option is kept only if it still co-occurs with the anchor in an
 * available variant; otherwise it is reset to "All". This is the key rule that stops
 * the dropdowns filtering each other into a locked state: changing any option in any
 * order always yields a valid, broadenable selection, and "All" is always reachable.
 * Works for any number/order of options (it never assumes a first/second option).
 */
export function reconcileSelection(
  variants: VariantLike[],
  options: OptionLike[],
  previous: Selection,
  changedOptionId: string,
  changedValueId: string,
): Selection {
  const next: Selection = changedValueId ? { [changedOptionId]: changedValueId } : {};
  for (const opt of options) {
    if (opt.id === changedOptionId) continue;
    const val = previous[opt.id];
    if (!val) continue; // already "All" — leave it broad
    const trial: Selection = { ...next, [opt.id]: val };
    if (variantsForSelection(variants, trial).length > 0) next[opt.id] = val;
  }
  return next;
}

/**
 * The variant to PRESENT (title/image/price/SKU/gallery) for the current selection —
 * the exact variant when every option is chosen, else the single variant that matches
 * a partial selection. Null when zero or many variants match. Derived, never stored:
 * showing a single match must NOT mutate the dropdowns (they keep their "All" state so
 * the customer can always broaden or switch).
 */
export function presentationVariant(variants: VariantLike[], selection: Selection): VariantLike | null {
  const exact = resolveSelectedVariant(variants, selection);
  if (exact) return exact;
  const matches = variantsForSelection(variants, selection);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Value ids for `optionId` that are backed by at least one valid variant given the
 * current selection of the OTHER options (combination-aware). Drives the dropdowns
 * so every REACHABLE choice is offered — including values that lead to an
 * out-of-stock variant, so a customer can still filter to and view every valid
 * combination (the out-of-stock state is surfaced on the card/button, not by hiding
 * the option).
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
 *  - ADD         : a fully-selected (or single-matching) in-stock variant is ready
 *  - OUT_OF_STOCK: the selected variant (or simple product) is out of stock
 *
 * ADD is reached whenever exactly ONE variant matches the active filters (a full
 * selection, or a partial one that happens to be unambiguous) — so a customer can add
 * to cart without redundantly picking an option that has only one possibility.
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
  const variant = presentationVariant(variants, selection);
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
