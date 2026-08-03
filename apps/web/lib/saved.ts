import { api } from './api';

/**
 * Saved products (wishlist) & recently-viewed API layer (see the M20 backend).
 * All endpoints require CUSTOMER auth; guests get 401 and are routed to login
 * by the calling islands.
 */

/** A catalog card as returned by the saved/recently-viewed endpoints. */
export interface Card {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  featured: boolean;
  ratingAverage: number;
  ratingCount: number;
  category: { name: string; slug: string };
  vendor: { businessName: string; slug: string };
  primaryImageUrl: string | null;
  inStock: boolean;
}

/** Availability signal for a saved variant (mirrors the API's variant view). */
export interface SavedVariantAvailability {
  inStock: boolean;
  lowStock: boolean;
  outOfStock: boolean;
  available: number | null;
  unlimited: boolean;
  allowBackorders: boolean;
}

/** The EXACT saved variant selection resolved by the API (present only for
 *  variant entries). Prefer these fields over the parent `product` when shown. */
export interface SavedVariant {
  variantId: string;
  /** Resolved variant title (displayName → option label → product title). */
  title: string | null;
  displayName: string | null;
  /** e.g. "Fragrance: Perfect in Pink · Size: Medium". */
  optionLabel: string | null;
  sku: string | null;
  priceMinor: number | null;
  salePriceMinor: number | null;
  imageUrl: string | null;
  availability: SavedVariantAvailability | null;
}

export interface SavedItem {
  /** Wishlist row id — unique per (product, variant); use as the React key. */
  id: string;
  productId: string;
  /** null for a product-level (no-variant) entry. */
  variantId: string | null;
  savedAt: string;
  available: boolean;
  product: Card | null;
  variant: SavedVariant | null;
}

export interface ViewedItem {
  productId: string;
  viewedAt: string;
  available: boolean;
  product: Card | null;
}

/** An exact saved selection key (productId + variantId) from `GET /saved/ids`. */
export interface SavedKey {
  productId: string;
  variantId: string | null;
}

/** Message the API returns (400) when a variant product is hearted with no
 *  concrete variant chosen. Mirrored here so the client can pre-empt the call. */
export const CHOOSE_OPTIONS_MESSAGE = 'Choose your options before adding this item to your Wishlist.';

/** Build the query suffix carrying the exact variant (omitted for product-level). */
function variantQuery(variantId?: string | null): string {
  return variantId ? `?variantId=${encodeURIComponent(variantId)}` : '';
}

export const savedApi = {
  list: () => api.get<{ items: SavedItem[] }>('/saved'),
  ids: () => api.get<{ productIds: string[]; saved: SavedKey[] }>('/saved/ids'),
  count: () => api.get<{ count: number }>('/saved/count'),
  save: (productId: string, variantId?: string | null) =>
    api.post<{ saved: true; productId: string; variantId: string | null }>(
      `/saved/${productId}${variantQuery(variantId)}`,
    ),
  unsave: (productId: string, variantId?: string | null) =>
    api.del<{ saved: false; productId: string; variantId: string | null }>(
      `/saved/${productId}${variantQuery(variantId)}`,
    ),
  recentlyViewed: (limit?: number) =>
    api.get<{ items: ViewedItem[] }>(`/recently-viewed${limit ? `?limit=${limit}` : ''}`),
  recordView: (productId: string) => api.post<{ ok: true }>(`/recently-viewed/${productId}`),
  clearRecentlyViewed: () => api.del<{ ok: true }>('/recently-viewed'),
};

/**
 * Is the EXACT (productId, variantId) selection currently saved? A heart is
 * "active" only for the precise entry — switching variant (or comparing a
 * product-level heart, variantId=null) flips the result. Pure + framework-free
 * so it is unit-testable and shared by every heart on the page.
 */
export function isVariantSaved(saved: SavedKey[], productId: string, variantId: string | null): boolean {
  const target = variantId ?? null;
  return saved.some((s) => s.productId === productId && (s.variantId ?? null) === target);
}

/** Cross-component sync: the wishlist badge + hearts refetch (or take a known
 *  count) on this, mirroring CART_CHANGED. */
export const SAVED_CHANGED = 'bmpl:saved-changed';
export function notifySavedChanged(count?: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAVED_CHANGED, { detail: { count } }));
  }
}

/**
 * Deduped, cached fetch of the caller's exact saved selections (productId +
 * variantId). A grid of hearts mounting at once all await the SAME in-flight
 * request instead of each firing a network call. Combine with `isVariantSaved`
 * to resolve a specific heart. `invalidateSaved()` clears the cache so the next
 * call refetches (used after a toggle).
 */
let savedCache: SavedKey[] | null = null;
let savedInFlight: Promise<SavedKey[]> | null = null;

export function fetchSaved(): Promise<SavedKey[]> {
  if (savedCache) return Promise.resolve(savedCache);
  if (savedInFlight) return savedInFlight;
  savedInFlight = savedApi
    .ids()
    .then((r) => {
      savedCache = r.saved ?? [];
      return savedCache;
    })
    .finally(() => {
      savedInFlight = null;
    });
  return savedInFlight;
}

/** Drop the cached saved selections so the next fetchSaved() hits the network. */
export function invalidateSaved(): void {
  savedCache = null;
  savedInFlight = null;
}

export const money = (c: number): string => `$${(c / 100).toFixed(2)}`;
