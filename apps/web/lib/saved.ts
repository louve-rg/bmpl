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

export interface SavedItem {
  productId: string;
  savedAt: string;
  available: boolean;
  product: Card | null;
}

export interface ViewedItem {
  productId: string;
  viewedAt: string;
  available: boolean;
  product: Card | null;
}

export const savedApi = {
  list: () => api.get<{ items: SavedItem[] }>('/saved'),
  ids: () => api.get<{ productIds: string[] }>('/saved/ids'),
  count: () => api.get<{ count: number }>('/saved/count'),
  save: (productId: string) => api.post<{ saved: true }>(`/saved/${productId}`),
  unsave: (productId: string) => api.del<{ saved: false }>(`/saved/${productId}`),
  recentlyViewed: (limit?: number) =>
    api.get<{ items: ViewedItem[] }>(`/recently-viewed${limit ? `?limit=${limit}` : ''}`),
  recordView: (productId: string) => api.post<{ ok: true }>(`/recently-viewed/${productId}`),
  clearRecentlyViewed: () => api.del<{ ok: true }>('/recently-viewed'),
};

/** Cross-component sync: the wishlist badge + hearts refetch (or take a known
 *  count) on this, mirroring CART_CHANGED. */
export const SAVED_CHANGED = 'bmpl:saved-changed';
export function notifySavedChanged(count?: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAVED_CHANGED, { detail: { count } }));
  }
}

/**
 * Deduped, cached fetch of the caller's saved product ids as a Set. A grid of
 * hearts mounting at once all await the SAME in-flight request instead of each
 * firing a network call. `invalidateSavedIds()` clears the cache so the next
 * call refetches (used after a toggle).
 */
let idsCache: Set<string> | null = null;
let idsInFlight: Promise<Set<string>> | null = null;

export function fetchSavedIds(): Promise<Set<string>> {
  if (idsCache) return Promise.resolve(idsCache);
  if (idsInFlight) return idsInFlight;
  idsInFlight = savedApi
    .ids()
    .then((r) => {
      idsCache = new Set(r.productIds);
      return idsCache;
    })
    .finally(() => {
      idsInFlight = null;
    });
  return idsInFlight;
}

/** Drop the cached saved-ids so the next fetchSavedIds() hits the network. */
export function invalidateSavedIds(): void {
  idsCache = null;
  idsInFlight = null;
}

export const money = (c: number): string => `$${(c / 100).toFixed(2)}`;
