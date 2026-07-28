# Phase 2 · M4 — Products

Product **core**: identity, categorization (single most-specific `categoryId`;
the category parent-chain provides category/subcategory), pricing (minor units),
SEO, physical dimensions, and the moderation lifecycle
(vendor creates → submits → admin approves → public). Images (M5) and inventory +
normalized variants (M6) attach in later milestones. Reuses guards, audit,
notifications, and the Zod pipe.

## Database (migration `20260728034942_add_products`)
- Enum `ProductStatus` (DRAFT/PENDING_REVIEW/PUBLISHED/REJECTED/SUSPENDED/ARCHIVED).
  `AuditAction` += `PRODUCT_*` (7) with shared mirror.
- `Product` (vendorProfile cascade, category `Restrict`, unique slug, `@@unique([vendorProfileId, sku])`,
  price/salePrice BigInt, currency, dims, featured, SEO, `searchKeywords String[]`,
  rating placeholders, publishedAt, rejectionReason). `Tag` + implicit m2m
  `ProductTags`. `ProductModerationReview` (immutable trail).

## Backend (`apps/api/src/products/`)
- `ProductsService` — vendor CRUD (unique slug/SKU, category existence, `salePrice ≤ price`,
  tag connect-or-create), lifecycle transitions (submit/archive/unarchive, delete DRAFT only),
  admin moderation (approve/reject/suspend/restore — transactional status + review + audit +
  vendor notification), and public list (filters: category, vendor, featured, basic `q`; sorts;
  pagination) + detail. Only PUBLISHED products of APPROVED vendors are public.
- Controllers: `ProductsController` (`@Roles('VENDOR')`, owner-scoped), `AdminProductsController`
  (`products.read`/`products.moderate`), `ProductsPublicController` (`@Public`).
- Storefront wired: `VendorService.publicStorefront` now returns the vendor's published
  **featuredProducts** + distinct **categories** (via `ProductsService.vendorFeatured`).

## Frontend
- **Admin**: Products nav + moderation queue (status filter) + detail with approve/reject/
  suspend/restore + moderation history.
- **Vendor web**: "My Products" list (submit/archive/unarchive/delete) + create/edit editor
  (title, description, SKU, barcode, category tree select, brand, price/sale, weight, dimensions,
  tags, SEO, featured) with submit-for-review.
- **Public web**: `/products` catalog (category filter, sort, pagination), `/products/[slug]`
  detail, storefront featured-products grid. Landing nav gains "Shop".

## Authorization & ownership
Vendor endpoints require an APPROVED VENDOR role and are owner-scoped by the caller's vendor
profile (cross-vendor read/edit → 404). Admin reads need `products.read`, decisions
`products.moderate`. Public surfaces never expose non-PUBLISHED products or products of
non-APPROVED vendors.

## Tests
- **Integration** (`products.integration.spec.ts`) — **13**: create/derive-slug, duplicate SKU 409,
  sale>price 400, draft/pending not public, approve→public + audit + notification, storefront
  featured, category/vendor filters, suspend/restore, vendor-suspension hides products, reject
  (reason required), cross-vendor 404, delete-DRAFT-only, authz matrix.
- **Unit**: product DTO tests (+3). **Full API integration suite: 90 passed (9 files).**
  shared 12, validation 15. api/web/admin build + typecheck clean.

## Migration & deployment
- Local + `bmpl_test`: applied. Railway Postgres: `prisma migrate deploy`.
- API redeploys (Railway, CI-gated); web + admin redeploy (Vercel, Git-connected). Live
  verification of the product endpoints + web `/products` recorded in the consolidated report.
