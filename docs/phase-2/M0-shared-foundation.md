# Phase 2 · M0 — Shared Foundation

Establishes the shared vocabulary and validation primitives the rest of Phase 2
builds on. **No database, backend, or frontend runtime changes** — this milestone
is pure `@bmpl/shared` + `@bmpl/validation` contracts, reused by every later
milestone. Fully additive; Phase 1 behavior is unchanged.

## What was added

### `@bmpl/shared`
- **Permissions** (`permissions.ts`): new marketplace permissions
  `vendors.read`, `vendors.moderate`, `products.read`, `products.moderate`,
  `categories.manage`. Wired into bundles — `SUPPORT_AGENT` gets the two
  read-only ones; `ADMIN` gets all five; `SUPER_ADMIN` inherits everything.
  (`AdminPermissionGrant.permission` is a `String` column, so this is TS-only —
  no migration.)
- **Storage** (`storage.ts`): `PRODUCT_IMAGE_MIME_ALLOWLIST`
  (jpeg/png/webp), `MAX_PRODUCT_IMAGE_BYTES` (8 MB), `isAllowedProductImageMime`,
  and new `STORAGE_PREFIX` namespaces — `vendorRoot`, `vendorLogo`,
  `vendorBanner`, `productImage`, `categoryImage`. Product images are namespaced
  **under the owning vendor** so one `assertKeyInNamespace` check covers them.
- **Marketplace vocab** (`marketplace.ts`, new): `VENDOR_APPROVAL_STATUSES`,
  `STORE_STATUSES`, `PRODUCT_STATUSES`, `MODERATION_ACTIONS`,
  `INVENTORY_CHANGE_REASONS`, `PRODUCT_SORTS`, `DAYS_OF_WEEK`, plus
  `isPubliclyVisibleProduct` / `isPubliclyVisibleVendor`. These are the single
  source of truth that Prisma enums in later milestones must match.
- **Slug** (`slug.ts`, new): `slugify` + `slugWithSuffix` for vendor/product/
  category URLs (uniqueness is handled by services on collision).

### `@bmpl/validation`
- **Marketplace primitives** (`marketplace.ts`, new): `slugSchema`,
  `moneyMinorSchema` / `optionalMoneyMinorSchema` (integer cents),
  `timeOfDaySchema` (HH:MM), `moderationDecisionSchema`, and zod enum schemas
  mirroring the shared vocab. Full per-resource DTOs compose these per milestone.

## Audit actions — deferred by design
`AuditLog.action` is a Prisma **enum**, so new audit codes require a migration.
To keep M0 strictly DB-free and the shared↔Prisma mirror truthful, each audit
code is added in the milestone that emits it (M1 `CATEGORY_*`, M2 `VENDOR_*`,
M4 `PRODUCT_*`, M6 `INVENTORY_ADJUSTED`), extending the Prisma enum and the
shared mirror together.

## Verification
- Build: `@bmpl/shared`, `@bmpl/validation`, **and all Phase 1 consumers**
  (`@bmpl/api`, `@bmpl/web`, `@bmpl/admin`) compile clean.
- Typecheck: shared + validation `tsc --noEmit` exit 0.
- Tests: shared **12**, validation **7** (new); authorization **5**, wallet **7**,
  api unit (env/zod/storage) **20** (unchanged) — all green.
- Migration: **none** (no schema change).
- Deployment: **none required** — the new constants are not consumed by any
  endpoint yet; they ship with M1's deploy.
