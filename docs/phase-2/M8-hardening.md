# Phase 2 · M8 — Production Hardening

A consistency/maintainability/security/performance pass over the M1–M7
marketplace. Behavior-preserving refactors + justified indexes + rate limits +
resilience + comprehensive onboarding documentation. No new features.

## Security
- **Ownership centralized:** new `OwnershipService` (`vendorProfileId`,
  `ownedProduct`) replaces four duplicated per-service ownership helpers
  (products, images, variants, inventory) — one enforcement path, identical
  semantics (cross-vendor → 404).
- **Rate limiting on upload presign:** `@StrictThrottle` added to product-image
  and vendor logo/banner presign endpoints (abuse-prone; issue signed URLs).
- Audited the full endpoint matrix — auth/roles/permissions/ownership/CSRF/
  validation/upload verification are consistent and complete (no gaps fixed
  beyond the above; documented in `API-INVENTORY.md` / `PERMISSION-MATRIX.md`).

## Database / performance
- **Two justified indexes:** `products(status, createdAt)` (replaces the plain
  `status` index; serves the default "newest published" catalog sort) and
  `product_images(productId, isPrimary)` (the batched primary-image lookup that
  runs on every listing).
- Confirmed the M7 raw-SQL catalog query uses the GIN tsvector index; no N+1
  (batched primary-image + in-stock maps; id-hydration).
- **Guarded the search indexes:** documented + hardened the migration so Prisma's
  auto-diff can never silently drop the manually-managed GIN/trigram indexes.

## API
- Documented the standard response shapes (paginated list, validation error,
  status codes) — already consistent across the codebase.
- **OpenAPI 3.1 spec** for every marketplace endpoint: `docs/openapi/marketplace.yaml`
  (43 paths, 9 schemas).

## Frontend
- Public list pages already degrade gracefully (M5 `serverGetSafe`). Added
  accessible labels (`aria-label`) to the catalog/vendor search + price inputs.

## Tests
- `InventoryService.availability` unit spec (6 cases: zero/in-stock/reserved/
  low-stock/unlimited/backorder) — critical stock math.
- `vendorQuerySchema` validation test. Full suite: **api integration 122 (12
  files)**, unit `@bmpl/validation` 22 + `@bmpl/api` availability 6 (+env/zod/
  storage), `@bmpl/shared` 12.

## Documentation (onboarding set, `docs/phase-2/`)
`MARKETPLACE-ARCHITECTURE.md`, `DATABASE-SCHEMA.md`, `API-INVENTORY.md`,
`ROUTE-INVENTORY.md`, `PERMISSION-MATRIX.md`, `DEPLOYMENT-GUIDE.md`,
`ENVIRONMENT-REFERENCE.md`, `DEVELOPER-SETUP.md`, and `docs/openapi/marketplace.yaml`.

## Code quality
Removed the duplicated ownership helpers and the now-unused imports
(`ForbiddenException` in three services, the stale `ORDER` map from M7). No dead
code or unnecessary abstractions introduced.

## Pending (unchanged)
Cloudflare R2 production upload verification — env-only, no code change (see
`DEPLOYMENT-GUIDE.md`).
