# Marketplace — Database Schema Overview

Prisma schema: `packages/database/prisma/schema.prisma`. All money is `BigInt`
minor units (BZD). Phase 2 added the models below; Phase 1 models (`User`,
`UserRole`, `Role`, `AdminPermissionGrant`, `AuditLog`, `Notification`, wallet…)
are reused unchanged.

## Entity map
```
User 1─1 VendorProfile 1─1 VendorSettings
                       1─* VendorLocation
                       1─* VendorOpeningHours
                       1─* VendorModerationReview
                       1─* Product
Category ─┐ (self parent/children, Restrict)
          └─* Product
Product 1─* ProductImage
        1─* ProductModerationReview
        *─* Tag
        1─* ProductOption 1─* ProductOptionValue
        1─* ProductVariant *─* ProductOptionValue (via VariantOptionValue)
        1─* Inventory 1─* InventoryChange
```

## Models
| Model (table) | Key columns | Notes |
|---|---|---|
| `Category` (categories) | slug*, name, parentId→self, iconName, imageKey, featured, isVisible, sortOrder | hierarchical; `onDelete: Restrict` |
| `VendorProfile` (vendor_profiles) | userId*(1‑1), slug*, businessName, logoKey, bannerKey, approvalStatus, storeStatus, socialLinks(Json), rating* | approval separate from the VENDOR role |
| `VendorSettings` (vendor_settings) | vendorProfileId*(1‑1), pickup/delivery/vacation/taxes/autoAccept, minimumOrderMinor, deliveryRadiusKm | operational toggles, separate for scale |
| `VendorLocation` (vendor_locations) | vendorProfileId, address, city, district, lat/lng, isPrimary | |
| `VendorOpeningHours` (vendor_opening_hours) | vendorProfileId, dayOfWeek*, open/closeTime, isClosed | unique per (profile, day) |
| `VendorModerationReview` (vendor_moderation_reviews) | vendorProfileId, reviewerId, action, from/toStatus | immutable trail |
| `Product` (products) | vendorProfileId, categoryId, slug*, sku, price/salePriceMinor, status, featured, dims, SEO, searchKeywords[], searchVector(tsvector) | `@@unique(vendorProfileId, sku)` |
| `Tag` (tags) | slug*, name | implicit m2m with Product |
| `ProductImage` (product_images) | productId, storageKey*, mimeType, fileSizeBytes, width/height, altText, caption, position, isPrimary | one primary/product (transactional) |
| `ProductModerationReview` (product_moderation_reviews) | productId, reviewerId, action, from/toStatus | immutable trail |
| `ProductOption` (product_options) | productId, name, position | unique (product, name) |
| `ProductOptionValue` (product_option_values) | productOptionId, value, position | unique (option, value) |
| `ProductVariant` (product_variants) | productId, sku, price overrides, isActive | unique (product, sku) |
| `VariantOptionValue` (variant_option_values) | variantId, productOptionValueId | the variant↔value combination |
| `Inventory` (inventory) | productId, variantId?, quantity, reserved, lowStockThreshold, unlimited, allowBackorders | one product-level row (variantId NULL) via partial unique index; per-variant via `variantId` unique |
| `InventoryChange` (inventory_changes) | inventoryId, delta, reason, previous/newQty, actorId, note | append-only history |

\* = unique.

## Enums (mirrored in `@bmpl/shared`)
`VendorApprovalStatus` (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED) · `StoreStatus`
(OPEN/CLOSED) · `ModerationAction` (SUBMITTED/APPROVED/REJECTED/SUSPENDED/RESTORED) ·
`ProductStatus` (DRAFT/PENDING_REVIEW/PUBLISHED/REJECTED/SUSPENDED/ARCHIVED) ·
`InventoryChangeReason` (INITIAL/MANUAL/RESTOCK/CORRECTION/RESERVE/RELEASE/BACKORDER).
`AuditAction` gained `CATEGORY_*`, `VENDOR_*`, `PRODUCT_*`, `INVENTORY_ADJUSTED`;
`NotificationType` gained `MARKETPLACE`.

## Indexes (beyond primary/unique keys)
- Category: `(parentId, sortOrder)`, `(isVisible)`
- VendorProfile: `(approvalStatus)`, `(storeStatus)`
- Product: `(status, createdAt)`, `(categoryId)`, `(vendorProfileId, status)`, `(featured)`,
  **GIN `searchVector`** (`products_search_idx`), **GIN trigram title** (`products_title_trgm_idx`)
- ProductImage: `(productId, position)`, `(productId, isPrimary)`
- Inventory: `(productId)` + partial unique `(productId) WHERE variantId IS NULL`
- InventoryChange: `(inventoryId, createdAt)`

## Cascade rules
Vendor/product child rows `onDelete: Cascade`. Category parent + Product→Category
`Restrict` (cannot orphan/delete-in-use). Actor references (`reviewerId`,
`actorId`) `SetNull` so history survives account changes.

## Migrations (Phase 2, `packages/database/prisma/migrations`)
`add_categories` · `add_vendor_profiles` · `add_products` · `add_product_images` ·
`add_inventory_variants` · `add_product_search` (trigger + GIN + pg_trgm) ·
`add_marketplace_indexes`.

> **Note on the search indexes:** `searchVector` is declared `Unsupported("tsvector")`
> and its GIN/trigram indexes + maintenance trigger are managed by **raw SQL** in the
> migrations. Prisma's auto-diff cannot see them and will emit `DROP INDEX` for them
> in any future `migrate dev` — always re-add `CREATE INDEX IF NOT EXISTS` for
> `products_search_idx` / `products_title_trgm_idx` (see `add_marketplace_indexes`).
