/**
 * Which placement slots a live customer page actually renders.
 *
 * DELIBERATELY a hardcoded, commented list — not an inference. The admin
 * console can assign an approved campaign to any slot in the enum, but 5 of
 * the 12 slots have no page requesting them, so a paying customer's promotion
 * can be "placed" somewhere that displays nothing. The placements tab uses
 * this map to say so at the point of assignment (inform, never block: staging
 * a placement ahead of a slot's launch is legitimate).
 *
 * UPDATE THIS LIST WHEN YOU MOUNT A BAND. The render sites, as of fb17b17:
 *   HOMEPAGE_*   → apps/web/app/page.tsx via components/marketing/PromotedSections.tsx
 *   MARKETPLACE  → apps/web/app/products/page.tsx:141 (unfiltered) and
 *                  components/discovery/CrossModuleDiscovery.tsx:80
 *   CATEGORY_PAGE→ apps/web/app/products/page.tsx:141 (when filtered by category)
 * Not rendered anywhere yet: BUSINESS_PAGE, JOBS, REAL_ESTATE, SEARCH,
 * DISCOVERY (see hive/bmpl-marketing-audit.md; DISCOVERY may be retired
 * rather than mounted — product owner's call).
 */
import type { PromotionPlacementType } from '@bmpl/shared';

/** Slot → where an operator would see it, in product words. */
export const LIVE_PLACEMENTS: Partial<Record<PromotionPlacementType, string>> = {
  HOMEPAGE_HERO: 'the homepage',
  HOMEPAGE_FEATURED_BUSINESSES: 'the homepage',
  HOMEPAGE_FEATURED_PRODUCTS: 'the homepage',
  HOMEPAGE_FEATURED_JOBS: 'the homepage',
  HOMEPAGE_FEATURED_PROPERTIES: 'the homepage',
  MARKETPLACE: 'the marketplace browse page',
  CATEGORY_PAGE: 'the marketplace browse page, when a category is selected',
};

export function rendersNowhereYet(placement: PromotionPlacementType): boolean {
  return !(placement in LIVE_PLACEMENTS);
}
