import { describe, expect, it } from 'vitest';
import { isVariantSaved, type SavedKey } from './saved';

const saved: SavedKey[] = [
  { productId: 'p1', variantId: 'v-pink-m' },
  { productId: 'p1', variantId: 'v-pink-l' },
  { productId: 'p2', variantId: null }, // product-level (no-variant) entry
];

describe('isVariantSaved', () => {
  it('matches the exact (productId, variantId) pair', () => {
    expect(isVariantSaved(saved, 'p1', 'v-pink-m')).toBe(true);
    expect(isVariantSaved(saved, 'p1', 'v-pink-l')).toBe(true);
  });

  it('is per-variant: a different variant of the same product is NOT active', () => {
    expect(isVariantSaved(saved, 'p1', 'v-pink-s')).toBe(false);
    // A product-level query (variantId=null) must not match a saved variant.
    expect(isVariantSaved(saved, 'p1', null)).toBe(false);
  });

  it('matches a product-level entry when variantId is null', () => {
    expect(isVariantSaved(saved, 'p2', null)).toBe(true);
    // Asking for a specific variant of a product only saved at product level → false.
    expect(isVariantSaved(saved, 'p2', 'v-anything')).toBe(false);
  });

  it('treats undefined variantId the same as null (product-level)', () => {
    expect(isVariantSaved(saved, 'p2', undefined as unknown as string | null)).toBe(true);
    expect(isVariantSaved(saved, 'p1', undefined as unknown as string | null)).toBe(false);
  });

  it('returns false for an unknown product', () => {
    expect(isVariantSaved(saved, 'nope', null)).toBe(false);
    expect(isVariantSaved([], 'p1', 'v-pink-m')).toBe(false);
  });
});
