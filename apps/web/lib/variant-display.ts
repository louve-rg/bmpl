/**
 * THE single presentation model for a selected/saved variant, shared by product
 * detail, variation cards, Cart, Wishlist, and the Storefront Preview — so every
 * surface shows the same hierarchy and never duplicates a value:
 *
 *   primary   → the variant's display name (line 1)
 *   secondary → the remaining selected option VALUES (lines 2+), excluding any that
 *               equals the primary (a display name that IS an option value)
 *   family    → the base product / product-family name (shown once), only when it
 *               differs from the primary
 *
 * Rules (see client spec §7 & §9):
 *  - NEVER split a combined "Name / Value" string; callers pass STRUCTURED data:
 *    the raw display name, the ordered option values, and the base product title.
 *  - Works for ANY number of options (not hardcoded to Size).
 *  - Vendor/store attribution is separate and handled by the caller.
 */
export interface VariantDisplayInput {
  /** variant.displayName — the preferred primary title. */
  displayName?: string | null;
  /** Selected option VALUES in option order, e.g. ["Twisted Peppermint","Small"]. */
  optionValues?: readonly string[] | null;
  /** Generated variant title (may be slash-combined) — used only as a fallback primary. */
  title?: string | null;
  /** Base product / product-family name, e.g. "Bath & Body". */
  productTitle?: string | null;
}

export interface VariantDisplay {
  /** Line 1 — the variant name. */
  primary: string;
  /** Lines 2+ — remaining option values (never equal to the primary). */
  secondary: string[];
  /** The base product / family, shown once; null when it would duplicate the primary. */
  family: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * Compute the display hierarchy from structured variant data. Primary precedence:
 * display name → first option value → generated title → base product title.
 */
export function variantDisplay(input: VariantDisplayInput): VariantDisplay {
  const values = (input.optionValues ?? []).map(clean).filter(Boolean);
  const primary =
    clean(input.displayName) || values[0] || clean(input.title) || clean(input.productTitle);
  // Drop any option value equal to the primary (case-insensitive) so a display name
  // that IS an option value (e.g. Fragrance = "Twisted Peppermint") isn't repeated.
  const secondary = values.filter((v) => v.toLowerCase() !== primary.toLowerCase());
  const family = clean(input.productTitle);
  return {
    primary,
    secondary,
    family: family && family.toLowerCase() !== primary.toLowerCase() ? family : null,
  };
}

/** Compact one-line join of the secondary option values ("Black · Size 10 · Wide"). */
export function secondaryLine(secondary: readonly string[]): string {
  return secondary.join(' · ');
}
