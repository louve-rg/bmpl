/**
 * Marketplace navigation hierarchy — single source of truth (M26.1).
 * The content hierarchy is: Stores (`/vendors`) → Storefront (`/store/:slug`) →
 * Product (`/products/:slug`, variant = `?variant=` query state on the SAME page).
 * Back controls + breadcrumbs are derived from entity data (not browser history),
 * so a product's "back" always returns to its own storefront and direct/shared
 * links get a correct trail. A selected variant is NOT a navigation level.
 */
export interface Crumb {
  label: string;
  href?: string;
}

/** The all-stores directory ("All Stores"). */
export const STORES_HREF = '/vendors';
export const STORES_LABEL = 'Stores';

/** A vendor's storefront — the level directly above any of its products. */
export const storefrontHref = (vendorSlug: string): string => `/store/${vendorSlug}`;

/** Home → Stores (current). */
export function storesBreadcrumbs(): Crumb[] {
  return [{ label: 'Home', href: '/' }, { label: STORES_LABEL }];
}

/** Stores → {store} (current). */
export function storefrontBreadcrumbs(businessName: string): Crumb[] {
  return [{ label: STORES_LABEL, href: STORES_HREF }, { label: businessName }];
}

/** Stores → {store} → {product} (current). One logical level per link. */
export function productBreadcrumbs(vendor: { businessName: string; slug: string }, productTitle: string): Crumb[] {
  return [
    { label: STORES_LABEL, href: STORES_HREF },
    { label: vendor.businessName, href: storefrontHref(vendor.slug) },
    { label: productTitle },
  ];
}

/** The product page's primary "back one level" target: its originating storefront. */
export const productBackHref = (vendorSlug: string): string => storefrontHref(vendorSlug);
