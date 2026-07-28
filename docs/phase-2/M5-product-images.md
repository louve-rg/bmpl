# Phase 2 · M5 — Product Images

Multi-image support for products, built entirely on the **existing storage
abstraction** (MinIO locally, R2 in cloud — env-only switch). No new upload
system: reuses the presign → client PUT → `headObject`-verify → persist flow,
the namespace/ownership guards, and the public/private bucket split.

## Database (migration `20260728144018_add_product_images`)
- `ProductImage` (`product_images`): `productId` (cascade), unique `storageKey`,
  `mimeType`, `fileSizeBytes`, `width?`, `height?`, `altText?`, `caption?`,
  `position`, `isPrimary`, `createdAt`. Index `(productId, position)`.
  `Product.images` relation added.
- **Exactly one primary per product** — enforced transactionally in the service
  (not a DB constraint), matching the required "transactional primary updates".

## Storage
- Extended `StorageService` with `deleteObject(key, visibility)` (best-effort,
  never throws) — used on image delete. Everything else reuses existing methods
  (`buildKey`, `presignUpload('public')`, `headObject('public')`, `publicUrl`,
  `assertKeyInNamespace`). MIME/size limits reuse the M0 constants.

## Backend (`apps/api/src/products/`)
- `ProductImagesService` — presign (MIME-validated), confirm (namespace +
  real MIME/size via `headObject`; width/height client-reported), list (URLs,
  primary-first), update alt/caption, **reorder** (full-list validation +
  transactional positions), **set primary** (transactional single-primary),
  **delete** (transactional; promotes next primary; best-effort object cleanup),
  and a batched `primaryUrls` helper (avoids N+1 on listings).
- `ProductImagesController` — `@Roles('VENDOR')`, owner-scoped, under
  `/vendor/products/:productId/images` (presign/confirm/list/reorder/primary/
  update/delete).
- Images surfaced in product views: vendor detail, admin detail (visibility),
  public detail (gallery), and primary thumbnails on public/vendor/storefront
  listings.

## Frontend
- **Vendor** (`apps/web`): `ImageManager` in the product editor — upload (reads
  pixel dimensions client-side), reorder (↑/↓), set primary, edit alt/caption,
  delete.
- **Public** (`apps/web`): product-detail `Gallery` (primary-first, thumbnail
  switching); primary thumbnails on `/products`, storefront featured, vendor list.
- **Admin** (`apps/admin`): read-only image grid on the product detail.

## Validation / Authorization
- DTOs: `productImageConfirmSchema` (key + optional dims/alt/caption),
  `productImageUpdateSchema`, `imageReorderSchema`. Server verifies real MIME +
  size; unsupported type / oversize / forged key → `400`.
- Owner-scoped: a vendor can only touch their own product's images (cross-vendor
  → `404`; customer → `403`; unauth → `401`). Storage-disabled → `503`.

## Public-page resilience (also completed)
Added `serverGetSafe` (never throws) and switched `/products` and `/vendors` to
render a proper **"temporarily unavailable"** state on API error instead of a
Next.js 500.

## Tests
- **Integration** (`product-images.integration.spec.ts`, real Postgres + MinIO) —
  **11**: MIME reject, upload+confirm auto-primary with real MIME/size, forged-key
  `400`, second image non-primary, set-primary single-invariant, reorder (+ bad
  reorder `400`), alt/caption update, delete-primary→promotion, public gallery,
  ownership matrix.
- **Unit**: image DTO tests (+2). **Full API integration suite: 101 passed
  (10 files).** shared 12, validation 17. api/web/admin build + typecheck clean.

## Deployment & pending item
- Migration applied local + `bmpl_test`; applied to Railway on deploy.
- Code deploys normally. **Production uploads return `503` until R2 is configured**
  — this is the single outstanding item:
  **"Production upload verification pending Cloudflare R2 configuration."**
  When R2 credentials are provided: set `STORAGE_PROVIDER=r2` + endpoint/keys +
  buckets `bmpl-public`/`bmpl-private` on Railway, redeploy, and run a real
  upload round-trip. No code change needed (env-only).
