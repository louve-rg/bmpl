/**
 * Marketplace (Phase 2) shared vocabulary.
 *
 * These const arrays are the single source of truth for marketplace status
 * values and MIRROR Prisma enums that are introduced in later milestones
 * (VendorProfile/Product/Inventory). When a milestone adds the corresponding
 * Prisma enum it MUST match the array here exactly.
 */

/** Approval lifecycle of a vendor's business profile / storefront. */
export const VENDOR_APPROVAL_STATUSES = [
  'DRAFT', // vendor is still editing; never public
  'PENDING', // submitted, awaiting admin review
  'APPROVED', // live/public
  'REJECTED', // admin rejected; vendor may revise + resubmit
  'SUSPENDED', // admin took a live storefront offline
] as const;
export type VendorApprovalStatus = (typeof VENDOR_APPROVAL_STATUSES)[number];

/** Operational open/closed state a vendor toggles for their storefront. */
export const STORE_STATUSES = ['OPEN', 'CLOSED'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

/** Product lifecycle. Only PUBLISHED is ever shown publicly. */
export const PRODUCT_STATUSES = [
  'DRAFT', // vendor editing
  'PENDING_REVIEW', // submitted for admin approval
  'PUBLISHED', // approved + live
  'REJECTED', // admin rejected
  'SUSPENDED', // admin pulled a live product
  'ARCHIVED', // vendor retired the product
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Moderation actions recorded on vendor/product review trails. */
export const MODERATION_ACTIONS = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'RESTORED',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Reasons captured on every append-only inventory change. */
export const INVENTORY_CHANGE_REASONS = [
  'INITIAL', // opening stock when inventory is first created
  'MANUAL', // vendor manual adjustment
  'RESTOCK', // stock added
  'CORRECTION', // fixing a counting error
  'RESERVE', // reserved for an order (Phase 3 wires this)
  'RELEASE', // reservation released back to available
  'BACKORDER', // fulfilled beyond on-hand stock
] as const;
export type InventoryChangeReason = (typeof INVENTORY_CHANGE_REASONS)[number];

/** The only product status visible on public marketplace surfaces. */
export const PUBLIC_PRODUCT_STATUS: ProductStatus = 'PUBLISHED';

/** The only vendor approval status visible on public marketplace surfaces. */
export const PUBLIC_VENDOR_STATUS: VendorApprovalStatus = 'APPROVED';

export const isPubliclyVisibleProduct = (status: ProductStatus): boolean =>
  status === PUBLIC_PRODUCT_STATUS;

export const isPubliclyVisibleVendor = (status: VendorApprovalStatus): boolean =>
  status === PUBLIC_VENDOR_STATUS;

/** Days of week for opening hours (0 = Sunday, matches JS Date.getDay()). */
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

/** Sort options accepted by the public product listing. */
export const PRODUCT_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'featured'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

// ---- Orders & checkout (Phase 3 · M10) --------------------------------------
// Only the INITIAL lifecycle states are defined here. Payment/fulfilment/refund
// states are deliberately NOT introduced yet (later milestones extend these).

/** Parent order lifecycle. PENDING at checkout; CANCELLED on authorization failure (M12). */
export const ORDER_STATUSES = ['PENDING', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Per-vendor sub-order lifecycle. PENDING at checkout; CANCELLED on authorization failure (M12). */
export const VENDOR_ORDER_STATUSES = ['PENDING', 'CANCELLED'] as const;
export type VendorOrderStatus = (typeof VENDOR_ORDER_STATUSES)[number];

/** Fulfilment method chosen per vendor order at checkout. */
export const DELIVERY_METHODS = ['PICKUP', 'DELIVERY'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Snapshotted order address kinds. Only SHIPPING is captured in M10. */
export const ORDER_ADDRESS_TYPES = ['SHIPPING'] as const;
export type OrderAddressType = (typeof ORDER_ADDRESS_TYPES)[number];

/**
 * Variant title precedence (M6.1). A variant's customer-facing marketplace title is
 * its own display name; else the option-value label join (e.g. "Red / Large");
 * else the base product title. Never falls through to the product title when the
 * variant has a name of its own — the single rule used everywhere a variant appears
 * (detail page, cards, cart, checkout, orders, search, API payloads).
 */
export function resolveVariantTitle(
  displayName: string | null | undefined,
  optionLabel: string | null | undefined,
  productTitle: string,
): string {
  const dn = displayName?.trim();
  if (dn) return dn;
  const ol = optionLabel?.trim();
  if (ol) return ol;
  return productTitle;
}
