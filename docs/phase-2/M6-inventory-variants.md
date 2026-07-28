# Phase 2 · M6 — Inventory & Variants

Fully **normalized** product variants (no JSON) and per-product / per-variant
inventory with an append-only history and transactional adjustments.

## Database (migration `20260728145152_add_inventory_variants`)
- **Variants (normalized):** `ProductOption` (unique per product name) →
  `ProductOptionValue` (unique per option) ; `ProductVariant` (optional sku/price
  overrides, unique sku per product) ; `VariantOptionValue` join (one value per
  option → a concrete combination).
- **Inventory:** `Inventory` (per variant, or per product when `variantId = null`):
  `quantity`, `reserved`, `lowStockThreshold`, `unlimited`, `allowBackorders`.
  A **partial unique index** (`variantId IS NULL`) enforces exactly one
  product-level row per product; variant rows are unique via `variantId`.
- **History:** `InventoryChange` (append-only): signed `delta`, `reason`
  (`InventoryChangeReason` enum), `previousQty`/`newQty`, actor, note.
- `AuditAction += INVENTORY_ADJUSTED` (+ shared mirror). Product gains
  `options`/`variants`/`inventory` relations.

## Backend (`apps/api/src/products/`)
- `InventoryService` — availability derivation (`available = qty − reserved`;
  `unlimited` ⇒ available `null`+always in stock; `lowStock`/`outOfStock`/
  backorder logic), get-or-create product row, **transactional `adjust`** (writes
  `InventoryChange` + audit, refuses negative on-hand), settings, history,
  reserve/release (Phase-3 hooks), and batched availability for listings.
- `VariantsService` — options/values CRUD (blocked once variants exist),
  variant create (validates one value per option, complete combination,
  rejects duplicate combos, opens variant inventory transactionally), update,
  delete (cascades links + inventory), and a public view.
- Controllers: `ProductVariantsController`, `ProductInventoryController`
  (`@Roles('VENDOR')`, owner-scoped; inventory endpoints take `?variantId=`).
- Public product detail now includes `options`, `variants` (with per-variant
  availability), and product-level `availability`.

## Frontend
- **Vendor** (`apps/web`): `VariantsInventory` in the product editor — options &
  values, variant builder (one select per option + SKU + opening qty), variant
  activate/delete, and an inventory panel per product/variant (adjust with
  reason, unlimited/backorder toggles, low-stock threshold, live stock badge).
- **Public** (`apps/web`): in-stock / low-stock / out-of-stock badge + a variant
  list (combination label, price, per-variant stock) on the product page.

## Validation / Authorization
- DTOs: option/value, variant create/update, inventory settings, inventory
  adjust (non-zero delta, reason enum). Owner-scoped throughout (cross-vendor →
  `404`, customer → `403`, unauth → `401`).

## Tests
- **Integration** (`inventory-variants.integration.spec.ts`) — **12**: auto-create
  product row, transactional adjust + history + audit, negative-guard `400`,
  low-stock/unlimited derivation, options CRUD, incomplete-combo `400`,
  duplicate-combo `409`, per-variant adjust, option-delete-blocked `409`, public
  options/variants/availability, ownership matrix.
- **Unit**: variant/inventory DTO tests (+3). **Full API integration suite: 113
  passed (11 files).** shared 12, validation 20. api/web/admin build clean.

## Migration & deployment
Applied local + `bmpl_test`; applied to Railway on deploy (partial unique index
included). No external credentials required.
