/**
 * Discovery & Recommendations (Phase 4 · M21) — shared sizing constants.
 * Deterministic, non-AI discovery built on the existing M7 search + M19 ratings +
 * M20 saved/viewed signals.
 */

/** Default number of products in a discovery/homepage section. */
export const DISCOVERY_SECTION_SIZE = 12;

/** Related / more-from-vendor cross-sell size on the product detail page. */
export const RELATED_SIZE = 8;

/** Personalized "for you" recommendation size. */
export const FOR_YOU_SIZE = 12;

/** Top categories shown on the discovery surface. */
export const TOP_CATEGORIES_SIZE = 8;

/** Max suggestions per group (products / categories / vendors) in typeahead. */
export const SUGGEST_SIZE = 5;

/** Minimum characters before search typeahead runs. */
export const SUGGEST_MIN_CHARS = 2;

/** A product needs at least this many ratings to appear in "top rated". */
export const TOP_RATED_MIN_RATINGS = 1;
