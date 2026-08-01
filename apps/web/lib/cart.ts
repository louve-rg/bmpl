import { api } from './api';

/** Mirrors the API cart view (see apps/api/src/cart/cart.service.ts). */
export interface CartLine {
  id: string;
  productId: string;
  variantId: string | null;
  title: string;
  slug: string;
  /** Variant-specific display name (e.g. "Perfect in Pink"); null for non-variant lines. */
  variantTitle?: string | null;
  variantLabel: string | null;
  sku: string | null;
  imageUrl: string | null;
  currency: string;
  quantity: number;
  unitPriceMinor: number;
  unitPriceMinorSnapshot: number;
  priceChanged: boolean;
  lineSubtotalMinor: number;
  available: number | null;
  inStock: boolean;
  issues: CartIssue[];
  purchasable: boolean;
}

export type CartIssue =
  | 'PRODUCT_UNAVAILABLE'
  | 'VENDOR_INACTIVE'
  | 'VARIANT_REQUIRED'
  | 'VARIANT_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK';

export interface CartVendorGroup {
  vendorProfileId: string;
  slug: string;
  businessName: string;
  storeStatus: string;
  subtotalMinor: number;
  itemCount: number;
  items: CartLine[];
}

export interface CartView {
  id: string;
  currency: string;
  itemCount: number;
  distinctItemCount: number;
  subtotalMinor: number;
  hasPriceChanges: boolean;
  hasUnavailableItems: boolean;
  vendors: CartVendorGroup[];
  updatedAt: string;
}

export const cartApi = {
  get: () => api.get<CartView>('/cart'),
  add: (body: { productId: string; variantId?: string | null; quantity: number }) =>
    api.post<CartView>('/cart/items', body),
  update: (itemId: string, quantity: number) => api.patch<CartView>(`/cart/items/${itemId}`, { quantity }),
  remove: (itemId: string) => api.del<CartView>(`/cart/items/${itemId}`),
  clear: () => api.del<CartView>('/cart'),
};

/** Cross-component sync: the cart badge refetches (or takes a known count) on this. */
export const CART_CHANGED = 'bmpl:cart-changed';
export function notifyCartChanged(count?: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CART_CHANGED, { detail: { count } }));
  }
}

export const ISSUE_LABELS: Record<CartIssue, string> = {
  PRODUCT_UNAVAILABLE: 'No longer available',
  VENDOR_INACTIVE: 'Store unavailable',
  VARIANT_REQUIRED: 'Choose an option',
  VARIANT_UNAVAILABLE: 'Option unavailable',
  OUT_OF_STOCK: 'Out of stock',
  INSUFFICIENT_STOCK: 'Not enough in stock',
};

export const money = (c: number): string => `$${(c / 100).toFixed(2)}`;
