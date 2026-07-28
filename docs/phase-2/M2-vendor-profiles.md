# Phase 2 · M2 — Vendor Business Profiles

Approved VENDOR-role users build one business profile with operational settings,
locations, and opening hours, submit it for admin review, and admins moderate it
(approve / reject / suspend / restore). Reuses the role/permission guards, audit
writer, notifications, storage, and Zod pipe — nothing duplicated.

## Database (migration `20260728024927_add_vendor_profiles`)
- Enums: `VendorApprovalStatus` (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED),
  `StoreStatus` (OPEN/CLOSED), `ModerationAction`. `AuditAction` += `VENDOR_*` (5);
  `NotificationType` += `MARKETPLACE`. Shared mirrors updated.
- Models: `VendorProfile` (1:1 User, unique slug, branding keys, approval + store
  status, rating placeholders), `VendorSettings` (pickup/delivery/vacation/min-order/
  delivery-radius/taxes/auto-accept — separate model for future scale), `VendorLocation`,
  `VendorOpeningHours` (unique per day), `VendorModerationReview` (immutable trail).
- User back-relations: `vendorProfile`, `vendorReviewsMade`.

## Backend (`apps/api/src/vendor/`)
- `VendorService` — owner ops (create with derived unique slug, update, submit
  DRAFT/REJECTED→PENDING, settings, locations with single-primary invariant, replace-all
  hours, logo/banner presign+confirm to the **public** bucket) and admin ops (list, detail,
  moderate with strict state transitions). Moderation is transactional: status update +
  `VendorModerationReview` + audit + vendor notification commit together.
- `VendorController` (`@Roles('VENDOR')`, owner-scoped by `userId`) and
  `AdminVendorsController` (`vendors.read` / `vendors.moderate`). Registered `VendorModule`.
- DTOs: create/update profile, settings, location, replace-all hours, image presign/confirm.

## Authorization & ownership
- Vendor endpoints require an APPROVED VENDOR role; the profile is always resolved from
  the caller's `userId`, so cross-vendor access is structurally impossible (a vendor
  editing another's location → `404`). Image keys are namespaced under the vendor and
  checked with `assertKeyInNamespace` (forged key → `400`).
- Admin reads need `vendors.read`, decisions `vendors.moderate`; reject requires a reason.

## Frontend
- **Admin** (`apps/admin`): Vendors nav + list (status filter) + detail page (branding,
  business info, locations, hours, settings, moderation history) with approve/reject/
  suspend/restore actions.
- **Vendor web** (`apps/web`): "My Store" (shown only to approved vendors) — create,
  business details, logo/banner upload, operations settings, locations, opening-hours
  editor, and submit-for-review with live status. Web client gained `put`/`del`.
  *(Ships live in M3 when the web app is deployed.)*

## Tests
- **Integration** (`vendor.integration.spec.ts`, real Postgres + MinIO) — **16**: full
  lifecycle, settings, single-primary locations, hours validation, **logo upload
  round-trip to MinIO**, forged-key rejection, submit→approve with audit+notification,
  invalid transition `409`, suspend/restore trail, reject-requires-reason, cross-vendor
  ownership `404`, and the authz matrix (customer `403`, unauth `401`, admin-without-
  moderate `403`).
- **Unit** — vendor DTO tests (+2). Full API integration suite green; shared 12,
  validation 12; api/web/admin build + typecheck clean.

## Migration & deployment
- Local dev + `bmpl_test`: applied. Railway Postgres: `prisma migrate deploy`.
- API redeploys via Railway (CI-gated). Admin redeploys via Vercel. Live verification of
  the vendor + admin endpoints below.

## Required configuration (surfaced, not blocking)
Logo/banner upload needs object storage. Locally MinIO serves it (tests pass). **In the
cloud the API runs `STORAGE_PROVIDER=none`, so `/vendor/profile/logo|banner/presign`
returns `503` until Cloudflare R2 is configured** (`STORAGE_PROVIDER=r2`,
`STORAGE_ENDPOINT`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`,
`STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BUCKET`, optional `STORAGE_PUBLIC_BASE_URL`).
All non-image vendor features work in the cloud today.
