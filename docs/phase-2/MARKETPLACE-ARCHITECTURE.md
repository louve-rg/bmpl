# BMPL Marketplace — Architecture Overview

Phase 2 built the Marketplace Foundation on top of the Phase 1 platform
(identity, roles, admin permissions, audit, notifications, storage). This is the
onboarding entry point; see the sibling docs for the [database schema](./DATABASE-SCHEMA.md),
[API inventory](./API-INVENTORY.md), [route inventory](./ROUTE-INVENTORY.md),
[permission matrix](./PERMISSION-MATRIX.md), [deployment](./DEPLOYMENT-GUIDE.md),
[environment reference](./ENVIRONMENT-REFERENCE.md), and [developer setup](./DEVELOPER-SETUP.md).

## Monorepo layout
```
apps/
  api/     NestJS 10 API (REST, /api prefix)
  web/     Next.js 14 (App Router) — public marketplace + vendor dashboard
  admin/   Next.js 14 — admin/moderation console
  mobile/  Expo/React Native (foundation only)
packages/
  database/       Prisma schema + client (@bmpl/database)
  shared/         framework-agnostic vocab: roles, permissions, audit, storage,
                  marketplace enums, slug (@bmpl/shared)
  validation/     Zod DTOs (@bmpl/validation)
  authentication/ argon2 + JWT helpers
  authorization/  role/permission predicates
  wallet/         double-entry ledger (Phase 1)
```

## Backend module map (`apps/api/src`)
| Module | Responsibility |
|---|---|
| `categories/` | hierarchical categories: public tree + admin CRUD (M1) |
| `vendor/` | vendor profile, settings, locations, hours, logo/banner, admin moderation, public storefront (M2/M3) |
| `products/` | product CRUD + lifecycle, images, options/variants, inventory, admin moderation, public catalog/search (M4–M7) |
| `cart/` | authenticated customer shopping cart — self-scoped; server-authoritative pricing; vendor-grouped (Phase 3 · M9) |
| `orders/` | checkout + orders — transactional cart→order conversion, inventory reservation, price snapshots; customer/vendor/admin reads (Phase 3 · M10) |
| `payments/` | payment & wallet-hold FOUNDATION — payment state machine, soft wallet holds, ledger references, idempotency; read-only customer/admin (Phase 3 · M11; no money moves) |
| `wallet/` | double-entry ledger persistence + escrow — posts balanced customer↔escrow transactions, derives balances, read-only wallet/escrow views (Phase 3 · M12; first real money movement) |
| `storage/` | S3-compatible object storage (MinIO/R2) — presign, headObject, publicUrl |
| `auth/`, `common/`, `throttling/`, `audit/`, `notifications/` | reused Phase 1 cross-cutting infrastructure |

`products/` service breakdown:
- `ProductsService` — product lifecycle + public catalog (raw-SQL search).
- `ProductImagesService` — image upload/reorder/primary/delete.
- `VariantsService` — normalized options/values/variants.
- `InventoryService` — stock, availability derivation, transactional adjustments, history.
- `OwnershipService` — **single source of truth** for vendor-ownership checks
  (`vendorProfileId`, `ownedProduct`) reused by every owner-scoped service.

## Request lifecycle & security
Global guard chain (in order): **rate-limit → CSRF → JWT auth → roles → permissions**.
- **Public** marketplace reads are `@Public()` (no auth; CSRF skipped).
- **Vendor** endpoints require an APPROVED `VENDOR` role (`@Roles('VENDOR')`) and are
  owner-scoped by `userId` via `OwnershipService` (cross-vendor access → 404).
- **Admin** endpoints require an explicit permission (`@RequirePermission(...)`) —
  a separate axis from customer roles.
- Mutations from browsers carry a double-submit CSRF token + Origin allow-list;
  bearer/native and non-browser callers are exempt. Presign/upload endpoints add a
  stricter per-IP rate limit (`@StrictThrottle`).
- Every privileged/moderation/stock action writes an immutable `AuditLog` row.

## Approval flows
- **Vendor:** DRAFT → (submit) PENDING → admin APPROVE → APPROVED (public) / REJECT →
  REJECTED / SUSPEND ↔ RESTORE. A moderation-review trail + vendor notification per step.
- **Product:** created **PUBLISHED** immediately — **no pre-review step**. The
  `featured` flag surfaces it in featured placement; others appear in normal
  rotation. The vendor can ARCHIVE ↔ re-publish; admins can SUSPEND ↔ RESTORE a
  live product (reactive moderation). Only products of an **APPROVED vendor** are
  public (the storefront still gates visibility).

## Storage strategy
One S3-compatible abstraction (`StorageService`) serves **MinIO** locally and
**Cloudflare R2** in the cloud — switching is env-only. Two buckets: **private**
(KYC docs, signed URLs only) and **public** (product/vendor/category images). Upload
flow: presign (MIME-validated) → client PUT → `headObject` verify (real MIME/size) →
persist opaque storage key. Keys are namespaced per owner and checked with
`assertKeyInNamespace`.

## Search & inventory strategy
- **Search (PostgreSQL only):** a trigger-maintained `tsvector` (title=A, brand+
  keywords=B, description=C) with a GIN index, plus `pg_trgm` for fuzzy title match.
  The public catalog is a single raw SQL query (FTS + recursive category-subtree CTE +
  price/featured/in-stock filters + `ts_rank` relevance + pagination), then hydrated
  with Prisma.
- **Inventory:** per product (or per variant) with `quantity`/`reserved`/derived
  `available`, `unlimited`, `allowBackorders`, `lowStockThreshold`; append-only
  `InventoryChange` history; all mutations transactional (never below zero on-hand).

## Shopping cart (Phase 3 · M9)
One active server-side `Cart` per customer (`userId` unique); `CartItem` rows
reference **either** a product (`variantId` null) or a specific variant — never
both, enforced by a `(cartId, variantId)` unique plus a partial unique
`(cartId, productId) WHERE variantId IS NULL` so duplicate additions **merge**.
The cart is pure customer self-service: **no admin approval or moderation**, and
no vendor/admin surface onto customer carts. The **server is the price authority**
— each read recomputes the effective unit price (variant sale → variant price →
product sale → product price) and flags a `priceChanged` vs the stored snapshot;
frontend-sent prices are ignored. Availability is validated on every add/update/
read (respecting `unlimited`/`allowBackorders`) but **inventory is never reserved**
in the cart — reservation happens at checkout/order creation (M10+). Items are
returned **grouped by vendor**; each group is the seed for one vendor order in the
future checkout split. See the [M9 doc](../phase-3/M9-shopping-cart.md).

## Checkout & orders (Phase 3 · M10)
Checkout converts a validated cart into a normalized order graph in **one
transaction**: a parent `Order`, one `VendorOrder` per storefront (the multi-vendor
split), immutable `OrderItem` snapshots (title/variant/SKU/unit price), and a
snapshotted `OrderAddress`. It re-validates every product/variant/storefront and
inventory one final time, then **reserves inventory for the first time**
(`InventoryService.reserve`, incrementing `Inventory.reserved`) — all inside the
same transaction, so any failure rolls back the order **and** the reservations
atomically; the cart is cleared only on success. The **server recomputes and
snapshots all prices** (shared `effectiveUnitPrice`); the client sends no prices.
M10 creates orders in `PENDING` only — no payment/tax/shipping/fees/dispatch. Each
`VendorOrder` carries its `deliveryMethod` (PICKUP/DELIVERY), customer notes, and a
reserved `shippingMetadata` placeholder, seeding future per-vendor fulfilment.
See the [M10 doc](../phase-3/M10-checkout-orders.md).

## Payments & wallet holds (Phase 3 · M11 — foundation)
Checkout also lays the **financial foundation** in the same transaction: a
`Payment` per order (state machine `CREATED→PENDING`; `AUTHORIZED/FAILED/EXPIRED/
CANCELLED` defined, capture states deliberately absent), a soft `WalletHold`
(`HELD` — a reservation of intent, **not** an escrow ledger entry), a PENDING
`LedgerReference` (the planned movement, unposted), and `PaymentEvent`s. **No
money moves**: no `WalletLedgerEntry` is written and no balance changes — the
existing double-entry wallet package is reused, but its money-movement gate stays
off. Checkout is **idempotent** via an `Idempotency-Key` header backed by a unique
`IdempotencyKey(userId, scope, key)` — a duplicate retry replays the original
order/payment. The design is gateway-agnostic (wallet / card / bank) without
schema redesign. Releasing an order's reservations (M10.1) also releases the hold
and cancels the payment. See the [M11 doc](../phase-3/M11-payments-wallet.md).

## Wallet authorization & escrow (Phase 3 · M12 — first real money movement)
`POST /api/payments/:id/authorize` performs the platform's **first real money
movement**: after validating the customer's wallet (exists / active / correct
currency / sufficient balance / not locked / not suspended), it moves funds
**customer wallet → escrow** as a **balanced double-entry** `WalletTransaction`
(DEBIT customer, CREDIT `SYSTEM_ESCROW`, net 0 — enforced by the `@bmpl/wallet`
`assertBalanced`), posts the `LedgerReference`, marks the `WalletHold` `AUTHORIZED`,
and transitions the payment `PENDING→AUTHORIZED` — all in one transaction. Money
moves **only** customer↔escrow; **vendor balances are never touched** and escrow
holds the funds until a future settlement milestone. Real movement is gated by the
wallet package's `assertMoneyMovementEnabled`, passed `true` **only** for these
escrow operations. (Correction: there is no global `WALLET_MONEY_MOVEMENT_ENABLED`
in code — the gate is this per-call argument, and no real-money rail exists.) The
`WalletTransaction.reference` (`payment:<id>:auth`) is unique → ledger-level
idempotency (re-authorizing replays, never double-debits). On any validation
failure the order is rolled back atomically (hold + reservation released, order
`CANCELLED`, payment `FAILED`, no money moved). Releasing an authorized order
reverses the escrow (escrow→customer). See the [M12 doc](../phase-3/M12-wallet-authorization-escrow.md).

## Money & i18n
Prices are `BigInt` **minor units** (cents), currency `BZD` (matches the wallet).
Districts are the six Belize districts (`District` enum).
