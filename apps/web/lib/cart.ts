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
  /** Raw vendor display name (preferred primary title); null when unset/non-variant. */
  displayName?: string | null;
  variantLabel: string | null;
  /** Structured selected option VALUES in option order (e.g. ["Twisted Peppermint","Small"]). */
  optionValues?: string[];
  /** Labeled option pairs in option order (e.g. [{name:"Size",value:"Small"}]) for the checkout summary. */
  options?: Array<{ name: string; value: string }>;
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
  | 'INSUFFICIENT_STOCK'
  // Paired with #387: storeStatus was already read and returned by
  // cart.service.ts's buildView() but never added to `issues`, so a
  // CLOSED-store line looked purchasable right up to the checkout submit.
  // Deliberately its own value, not a reuse of VENDOR_INACTIVE -- that one
  // means approvalStatus !== APPROVED specifically (see its own comment
  // below), a genuinely different condition from a store temporarily
  // closed by its own owner. This half (the union member + its label) is
  // harmless and unused until the API side (Pam, cart.service.ts) actually
  // sends it -- independent work, neither side waits on the other.
  | 'STORE_CLOSED';

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

/** The cart view returned by move-to-wishlist, plus the outcome of the move. */
export interface MoveToWishlistResult extends CartView {
  movedToWishlist: true;
  /** true when the exact variant was already in the wishlist (still removed from cart). */
  alreadySaved: boolean;
  productId: string;
  variantId: string | null;
}

export const cartApi = {
  get: () => api.get<CartView>('/cart'),
  add: (body: { productId: string; variantId?: string | null; quantity: number }) =>
    api.post<CartView>('/cart/items', body),
  update: (itemId: string, quantity: number) => api.patch<CartView>(`/cart/items/${itemId}`, { quantity }),
  remove: (itemId: string) => api.del<CartView>(`/cart/items/${itemId}`),
  /** Save the exact variant to the wishlist and remove the line (atomic, server-side). */
  moveToWishlist: (itemId: string) =>
    api.post<MoveToWishlistResult>(`/cart/items/${itemId}/move-to-wishlist`),
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
  // No fee, no timeframe, no reopening promise -- we do not know when (or
  // whether) the store reopens and must not imply we do (owner constraint).
  STORE_CLOSED: 'Store closed',
};

export const money = (c: number): string => `$${(c / 100).toFixed(2)}`;
