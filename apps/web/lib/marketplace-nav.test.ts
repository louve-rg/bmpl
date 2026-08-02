import { describe, expect, it } from 'vitest';
import {
  STORES_HREF,
  storefrontHref,
  storesBreadcrumbs,
  storefrontBreadcrumbs,
  productBreadcrumbs,
  productBackHref,
} from './marketplace-nav';

const vendor = { businessName: 'Sunny Store', slug: 'sunny-store' };

describe('marketplace navigation hierarchy (M26.1)', () => {
  it('product back returns to the ORIGINATING STOREFRONT, not the all-products list', () => {
    // The core fix: the old "← Shop" pointed at /products (a different level).
    expect(productBackHref(vendor.slug)).toBe('/store/sunny-store');
    expect(productBackHref(vendor.slug)).not.toBe('/products');
    expect(productBackHref(vendor.slug)).toBe(storefrontHref(vendor.slug));
  });

  it('storefront link is /store/:slug and stores directory is /vendors', () => {
    expect(storefrontHref('abc')).toBe('/store/abc');
    expect(STORES_HREF).toBe('/vendors');
  });

  it('breadcrumbs follow the true hierarchy Stores → Store → Product, each one level up', () => {
    const crumbs = productBreadcrumbs(vendor, 'Blue Widget');
    expect(crumbs.map((c) => c.label)).toEqual(['Stores', 'Sunny Store', 'Blue Widget']);
    // Stores links to the directory; the store crumb links to THIS vendor's storefront.
    expect(crumbs[0]?.href).toBe(STORES_HREF);
    expect(crumbs[1]?.href).toBe(storefrontHref(vendor.slug));
    // The current page (product) is the last crumb and is NOT a link (no dead-end self-link).
    expect(crumbs.at(-1)?.href).toBeUndefined();
  });

  it('storefront breadcrumb: Stores → {store} (current, unlinked)', () => {
    const crumbs = storefrontBreadcrumbs(vendor.businessName);
    expect(crumbs.map((c) => c.label)).toEqual(['Stores', 'Sunny Store']);
    expect(crumbs[0]?.href).toBe(STORES_HREF);
    expect(crumbs[1]?.href).toBeUndefined();
  });

  it('stores directory breadcrumb: Home → Stores (current, unlinked)', () => {
    const crumbs = storesBreadcrumbs();
    expect(crumbs.map((c) => c.label)).toEqual(['Home', 'Stores']);
    expect(crumbs[0]?.href).toBe('/');
    expect(crumbs[1]?.href).toBeUndefined();
  });
});
