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
User 1─1 Cart 1─* CartItem *─1 Product / *─1 ProductVariant (Phase 3 · M9)
User 1─* Order 1─* VendorOrder 1─* OrderItem  (Phase 3 · M10)
              Order 1─* OrderAddress
              VendorOrder *─1 VendorProfile (Restrict)
Order 1─1 Payment 1─* WalletHold *─1 WalletAccount   (Phase 3 · M11, foundation)
             Payment 1─* LedgerReference *─1 WalletAccount (planned, unposted)
             Payment 1─* PaymentEvent / PaymentAttempt
             Payment *─1 PaymentMethod / IdempotencyKey
Product 1─* ProductImage
        1─* ProductModerationReview
        *─* Tag
        1─* ProductOption 1─* ProductOptionValue
        1─* ProductVariant *─* ProductOptionValue (via VariantOptionValue)
        1─* Inventory 1─* InventoryChange
VendorOrder 1─1 OrderDelivery (M13)                            (Phase 4)
OrderDelivery 1─* DeliveryAssignment (append-only history)     (M15)
              1─* DeliveryTimelineEvent (append-only)          (M15)
              *─1 DriverProfile (assignedDriver) / DriverVehicle (assignedVehicle)
User 1─1 DriverProfile 1─* DriverVehicle / DriverServiceArea   (M14)
Notification (event) 1─* NotificationRecipient *─1 User        (M16)
User 1─* NotificationPreference (per category)                 (M16)
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
| `Notification` (notifications) | type, category, event, title, body, data(Json) | **M16** the notification EVENT (fan-out capable); no per-user state |
| `NotificationRecipient` (notification_recipients) | notificationId, userId, channel, readAt, deletedAt | **M16** per-user read/dismiss state; unique (notification, user) |
| `NotificationPreference` (notification_preferences) | userId, category*, inApp, email, push | **M16** per-user per-category channel prefs; unique (user, category) |

\* = unique.

**M16 note:** the single per-user `notifications` table was normalized into a
`Notification` **event** + `NotificationRecipient` (per-user read/dismiss) so one
event can fan out to many recipients (e.g. an admin alert to every admin holding a
permission). Existing rows were migrated to one recipient each (no data loss).

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
- Cart (Phase 3 · M9): unique `(userId)` — one active cart per customer
- CartItem (Phase 3 · M9): `(cartId)`, `(productId)`, `(vendorProfileId)`,
  unique `(cartId, variantId)` + partial unique `(cartId, productId) WHERE variantId IS NULL`
  (variant lines unique per variant; product-level lines unique per product → duplicate adds merge)
- Order (Phase 3 · M10): unique `(orderNumber)`, `(userId, createdAt)`, `(status)`
- VendorOrder (Phase 3 · M10): unique `(orderNumber)`, `(orderId)`, `(vendorProfileId, createdAt)`, `(status)`
- OrderItem (Phase 3 · M10): `(vendorOrderId)`, `(productId)`
- OrderAddress (Phase 3 · M10): `(orderId)`
- Payment (Phase 3 · M11): unique `(paymentNumber)`, `(orderId)`, `(idempotencyKeyId)`, `(userId, createdAt)`, `(status)`
- PaymentMethod (Phase 3 · M11): unique `(userId, type)`, `(userId)`
- WalletHold (Phase 3 · M11): `(paymentId)`, `(walletAccountId, status)`
- LedgerReference / PaymentAttempt / PaymentEvent (Phase 3 · M11): `(paymentId)` (+ `(paymentId, createdAt)` for events)
- IdempotencyKey (Phase 3 · M11): unique `(userId, scope, key)`, `(userId)`
- WalletAccount (M12): + `status` (ACTIVE/LOCKED/SUSPENDED); unique `(userId, type, currency)`
- WalletHold (M12): + `AUTHORIZED` status + `walletTransactionId` (escrow tx backing an authorized hold)
- Order/VendorOrder (M12): + `CANCELLED` status (authorization-failure rollback)
- WalletTransaction (now used, M12): unique `(reference)` → ledger-level idempotency; entries sum to zero

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
