/**
 * Variation-card display lines. A card shows the variant's PRIMARY name, then every
 * remaining selected option value on its own visible line(s), then the price — for any
 * number of options, without hiding values in a tooltip or a truncated single line, and
 * without repeating a value that the primary name already is.
 */
import type { OptionLike, VariantLike } from './variant-availability';

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
 * Compute the card lines:
 * - primary = the vendor's displayName if set, else the first option value, else the title.
 * - secondary = the option values EXCLUDING one that equals the primary (dedup).
 */
export function variantCardLines(v: Pick<VariantLike, 'title' | 'displayName' | 'optionValueIds'>, options: OptionLike[]): VariantCardLines {
  const values = optionValuesFor(v.optionValueIds, options);
  const primary = (v.displayName && v.displayName.trim()) || values[0] || v.title;
  const secondary = values.filter((val) => val !== primary);
  return { primary, secondary };
}
