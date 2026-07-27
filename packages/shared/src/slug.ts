/**
 * Deterministic slug generation for vendor/product/category URLs.
 *
 * Lowercases, transliterates spaces/underscores to hyphens, strips anything that
 * isn't [a-z0-9-], and collapses/trims hyphens. Uniqueness is NOT handled here —
 * callers append a numeric suffix on collision (see the marketplace services).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse repeats
}

/** Append a short suffix to disambiguate a colliding slug (e.g. "shop" -> "shop-2"). */
export function slugWithSuffix(base: string, suffix: number): string {
  const clean = slugify(base) || 'item';
  return `${clean}-${suffix}`;
}
