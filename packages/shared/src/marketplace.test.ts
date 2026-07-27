import { describe, expect, it } from 'vitest';
import {
  INVENTORY_CHANGE_REASONS,
  MODERATION_ACTIONS,
  PRODUCT_STATUSES,
  STORE_STATUSES,
  VENDOR_APPROVAL_STATUSES,
  isPubliclyVisibleProduct,
  isPubliclyVisibleVendor,
} from './marketplace';
import {
  PRODUCT_IMAGE_MIME_ALLOWLIST,
  STORAGE_PREFIX,
  isAllowedProductImageMime,
} from './storage';
import { slugify, slugWithSuffix } from './slug';

describe('marketplace status vocabularies', () => {
  it('exposes the expected vendor approval statuses', () => {
    expect(VENDOR_APPROVAL_STATUSES).toEqual([
      'DRAFT',
      'PENDING',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
    ]);
  });

  it('exposes the expected product statuses', () => {
    expect(PRODUCT_STATUSES).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'PUBLISHED',
      'REJECTED',
      'SUSPENDED',
      'ARCHIVED',
    ]);
  });

  it('store, moderation, and inventory reason vocabularies are stable', () => {
    expect(STORE_STATUSES).toEqual(['OPEN', 'CLOSED']);
    expect(MODERATION_ACTIONS).toContain('RESTORED');
    expect(INVENTORY_CHANGE_REASONS).toContain('RESERVE');
    expect(INVENTORY_CHANGE_REASONS).toContain('BACKORDER');
  });

  it('only PUBLISHED products and APPROVED vendors are public', () => {
    expect(isPubliclyVisibleProduct('PUBLISHED')).toBe(true);
    expect(isPubliclyVisibleProduct('DRAFT')).toBe(false);
    expect(isPubliclyVisibleProduct('SUSPENDED')).toBe(false);
    expect(isPubliclyVisibleVendor('APPROVED')).toBe(true);
    expect(isPubliclyVisibleVendor('PENDING')).toBe(false);
  });
});

describe('product image storage vocabulary', () => {
  it('allows web-safe image mimes only', () => {
    expect(PRODUCT_IMAGE_MIME_ALLOWLIST).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(isAllowedProductImageMime('image/png')).toBe(true);
    expect(isAllowedProductImageMime('image/gif')).toBe(false);
    expect(isAllowedProductImageMime('application/pdf')).toBe(false);
  });

  it('namespaces product images under the owning vendor', () => {
    expect(STORAGE_PREFIX.vendorLogo('v1')).toBe('vendors/v1/logo');
    expect(STORAGE_PREFIX.vendorBanner('v1')).toBe('vendors/v1/banner');
    expect(STORAGE_PREFIX.productImage('v1', 'p9')).toBe('vendors/v1/products/p9');
    expect(STORAGE_PREFIX.categoryImage('c3')).toBe('categories/c3');
    // product-image keys live under the vendor root so one ownership check covers them
    expect(STORAGE_PREFIX.productImage('v1', 'p9').startsWith(STORAGE_PREFIX.vendorRoot('v1'))).toBe(
      true,
    );
  });
});

describe('slugify', () => {
  it('normalizes text into a url-safe slug', () => {
    expect(slugify('  Deshawn’s Corner Store! ')).toBe('deshawn-s-corner-store');
    expect(slugify('Café Olé')).toBe('cafe-ole');
    expect(slugify('Multiple   spaces__and--dashes')).toBe('multiple-spaces-and-dashes');
  });

  it('produces suffixed variants for collisions', () => {
    expect(slugWithSuffix('Shop', 2)).toBe('shop-2');
    expect(slugWithSuffix('!!!', 3)).toBe('item-3');
  });
});
