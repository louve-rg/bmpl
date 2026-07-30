# Phase 3 · M9 — Shopping Cart Foundation

The first Phase 3 milestone. It adds a production-ready, server-side shopping
cart on top of the Phase 2 marketplace. It deliberately stops short of checkout:
**no orders, payments, wallet movements, shipping, delivery, messaging, or
reviews** — and it introduces **no admin approval or moderation** step anywhere
(adding to the cart is pure customer self-service).

Related: [marketplace architecture](../phase-2/MARKETPLACE-ARCHITECTURE.md) ·
[database schema](../phase-2/DATABASE-SCHEMA.md) ·
[API inventory](../phase-2/API-INVENTORY.md) · [OpenAPI](../openapi/marketplace.yaml).

## Architecture decisions
- **Reuse, don't duplicate.** The cart reuses the existing authentication, the
  `@Roles('CUSTOMER')` role gate, Zod validation (`@bmpl/validation`), the global
  guard chain (rate-limit → CSRF → JWT → roles → permissions), the money model
  (`BigInt` minor units, BZD), and — crucially — `InventoryService.availability()`
  for stock derivation and `ProductImagesService.primaryUrls()` for thumbnails. No
  parallel pricing, inventory, or authorization logic was created.
- **Server is the price authority.** The add/update DTOs carry **no price**. The
  effective unit price is always computed server-side and, on read, recomputed
  from the live product/variant. Any price the frontend sends is ignored.
- **One active cart per customer.** `Cart.userId` is unique; the cart is
  get-or-created on first use. There is no concept of multiple/named carts in M9.
- **Relational, not JSON.** `Cart` + `CartItem` with real foreign keys and
  constraints (no JSON blobs), consistent with the normalized-variants decision.
- **No reservation in the cart.** Availability is *validated* but stock is never
  *held*. `Inventory.reserved` stays untouched by cart operations; reservation is
  a checkout/order concern (M10+). This keeps carts cheap and avoids phantom
  stock-outs from abandoned carts.
- **Cart mutations are not audited.** `AuditLog` is reserved for privileged /
  moderation / security / stock actions. Routine customer cart edits are ordinary
  self-service and would only add noise + write load, so they are intentionally
  not written to the audit trail (the `AuditService` remains the one writer for
  the events that do matter). Rate limiting still applies via the global throttler.

## Models & migration
Migration `20260729010000_add_shopping_cart` (see `packages/database/prisma/migrations`).

**`Cart`** — `id`, `userId` (**unique** → one active cart), `currency` (BZD),
`createdAt`, `updatedAt`. `onDelete: Cascade` from `User`.

**`CartItem`** — `id`, `cartId`, `productId`, `variantId?`, `vendorProfileId`
(denormalized owner), `quantity`, `unitPriceMinorSnapshot` (BigInt), timestamps.

Constraints / integrity:
- `@@unique([cartId, variantId])` — a variant appears once per cart (Postgres
  treats NULLs as distinct, so this only constrains variant lines).
- Partial unique `CREATE UNIQUE INDEX … ON cart_items(cartId, productId) WHERE variantId IS NULL`
  — a product-level line appears once per cart. Together these guarantee that a
  repeated add of the *same* purchasable **merges** onto one row.
- FKs all `onDelete: Cascade`: deleting the user, product, or variant removes the
  affected cart lines automatically (a product a vendor deletes simply disappears
  from carts).
- Indexes: `(cartId)`, `(productId)`, `(vendorProfileId)`.

A `CartItem` references **either** a product (`variantId = null`) or a specific
variant — never both, never neither. The service rejects invalid combinations:
a product that *has* variants requires one (`VARIANT_REQUIRED`); a `variantId`
must belong to the product and be active (`VARIANT_UNAVAILABLE`).

## API endpoints (`@Roles('CUSTOMER')`, self-scoped)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cart` | active cart, vendor-grouped, prices + availability re-validated |
| POST | `/api/cart/items` | add `{ productId, variantId?, quantity }` (merges) |
| PATCH | `/api/cart/items/:itemId` | set line quantity (≥1) |
| DELETE | `/api/cart/items/:itemId` | remove a line |
| DELETE | `/api/cart` | clear the cart |

Every route is scoped to `CurrentUser().userId`. A customer can only see/modify
their own cart; another customer's item id yields `404` (not found in *your*
cart). There is no vendor or admin endpoint onto customer carts.

## Pricing behaviour
- **Effective unit price** precedence: `variant.salePrice → variant.price →
  product.salePrice → product.price` (a variant with neither inherits the product).
- On add/update the effective price is written to `unitPriceMinorSnapshot`.
- On **every read** the current price is recomputed; `priceChanged` is `true` when
  it differs from the snapshot, and both `unitPriceMinor` (current — the source of
  truth) and `unitPriceMinorSnapshot` are returned.
- Totals: `lineSubtotalMinor = unitPriceMinor × quantity`; per-vendor
  `subtotalMinor` and the cart `subtotalMinor` sum only **purchasable** lines;
  `itemCount` is the total quantity across all lines (drives the header badge).
- **Out of scope (deferred):** tax, delivery fees, discounts, coupons, payment
  fees, and any checkout grand-total. The summary explicitly says fees are
  computed at checkout.

## Inventory behaviour
- Uses `InventoryService.availability()`. `unlimited` and `allowBackorders` are
  respected (always purchasable; `available` is `null` for unlimited/untracked).
- Add/update **reject** a quantity beyond `available` (merge-aware): `409`
  `OUT_OF_STOCK` when nothing is available, otherwise "Only N in stock".
- A product/variant with no inventory row is treated as available (the same
  convention the public catalog uses).
- **No reservation**: `reserved` is never changed by the cart (verified by test).

## Multi-vendor behaviour → future order split
Items are grouped by `vendorProfileId`. The response `vendors[]` array carries,
per storefront, its `businessName`/`slug`/`storeStatus`, a per-vendor
`subtotalMinor` and `itemCount`, and that vendor's `items[]`. This is the exact
shape the future checkout will consume: **each vendor group becomes one vendor
order** (its own fulfilment, escrow hold, and payout) at order-creation time in a
later milestone. Denormalizing `vendorProfileId` onto each item makes that split a
pure grouping with no extra joins.

## Web application
- **Add to Cart** on the public product page (`/products/[slug]`): variant
  selection (one `<select>` per option; the button stays disabled until a valid
  variant is chosen), a quantity selector, server-authoritative price on the
  button, success/failure messaging, and a **redirect to sign in** (`/login?next=…`)
  when the API returns `401`.
- **Cart icon with live count** in the site header (refreshes on a
  `cart:changed` event after any mutation).
- **Cart page** (`/cart`): vendor-grouped lines, quantity ± controls, remove,
  clear cart, price-change / unavailable / out-of-stock warnings, a subtotal
  summary, loading / empty / error states, a responsive two-column layout, and a
  **disabled "Checkout coming next"** control (no checkout behaviour). Accessible
  labels on all controls. Unauthenticated visitors are redirected to sign in.

## Access control
- Customers: own cart only (self-scoped by `userId`).
- Vendors: **no** access to customer carts (no vendor endpoint exists).
- Admins: **no** cart-management interface in M9 (no admin endpoint exists).

## Testing
`apps/api/test/cart.integration.spec.ts` — 21 tests against real Postgres: cart
creation + one-per-customer, add product / add variant, missing-variant &
invalid-variant rejection, duplicate merge, quantity update, removal, clear,
ownership isolation (404 across customers), unpublished-product & inactive-
storefront rejection, insufficient / unlimited / backorder inventory, price
recalculation + `priceChanged`, multi-vendor grouping, server-side price
authority (client-sent price ignored), no-reservation invariant, auth (401), and
validation (zero quantity / missing productId → 400). Full suite: **150 tests /
15 files** — no regressions.

## Known limitations / risks
- **No checkout** — the cart cannot yet become an order (by design; M10+).
- **No reservation** — a cart can pass validation and still be short at checkout
  if stock is sold meanwhile; the order step must revalidate + reserve atomically.
- **Guest carts** — only authenticated customers have a server cart; there is no
  anonymous/local cart or guest→user merge yet.
- **Cart TTL / abandonment jobs** — the schema is abandonment-ready
  (`updatedAt`), but no reaper/analytics job exists yet.
- **Currency** — single-currency (BZD) assumed, matching the rest of the platform.

## Recommended scope for M10
Checkout & order creation (no payment capture yet): turn each vendor group into a
`VendorOrder` under a parent `Order`, snapshot line prices, **atomically reserve
inventory** (reuse the existing `InventoryService.reserve()` hook) inside the
order transaction with a final availability re-check, capture a delivery/pickup
choice per vendor, and clear the cart on success. Wallet debits, payment
authorization, shipping, and delivery dispatch remain later milestones.
