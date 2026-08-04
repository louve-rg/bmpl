/**
 * Variation-card display lines. A card shows the variant's PRIMARY name, then every
 * remaining selected option value on its own visible line(s), then the price — for any
 * number of options, without hiding values in a tooltip or a truncated single line, and
 * without repeating a value that the primary name already is.
 */
import type { OptionLike, VariantLike } from './variant-availability';
import { variantDisplay, type VariantDisplay } from './variant-display';

/** The variant's selected option VALUES, in option order (e.g. ["Hello Beautiful","Large"]). */
export function optionValuesFor(optionValueIds: string[], options: OptionLike[]): string[] {
  const ids = new Set(optionValueIds);
  const out: string[] = [];
  for (const opt of options) {
    const v = opt.values.find((val) => ids.has(val.id));
    if (v) out.push(v.value);
  }
  return out;
}

export interface VariantCardLines {
  /** Line 1 — the variant's name. */
  primary: string;
  /** Lines 2+ — the remaining option values (never the primary), for display on their
   *  own line(s); join with " · " and allow wrapping. */
  secondary: string[];
}

/**
 * Card lines via the SHARED display model (lib/variant-display) so cards, detail,
 * Cart and Wishlist all apply one dedup rule. Cards omit the base product family
 * (the surrounding context already names the product).
 */
export function variantCardLines(
  v: Pick<VariantLike, 'title' | 'displayName' | 'optionValueIds'>,
  options: OptionLike[],
): VariantCardLines {
  const d: VariantDisplay = variantDisplay({
    displayName: v.displayName,
    optionValues: optionValuesFor(v.optionValueIds, options),
    title: v.title,
  });
  return { primary: d.primary, secondary: d.secondary };
}
