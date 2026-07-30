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

## Money & i18n
Prices are `BigInt` **minor units** (cents), currency `BZD` (matches the wallet).
Districts are the six Belize districts (`District` enum).
