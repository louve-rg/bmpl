# Lookup & Reference-Data Inventory

_Read-only platform-quality audit. Generated 2026-08-02. Scope: every managed
lookup / reference dataset the BMPL platform depends on._

This inventory answers, per dataset: does a schema exist? is it a **DB table** or a
**hardcoded shared enum** (`packages/shared/src/*`)? is it seeded (checked
`packages/database/prisma/seed.ts` + all data migrations under
`packages/database/prisma/migrations/`)? does production likely contain rows? does
the public API expose it? does the relevant form consume it? does admin manage it?
are labels consistent frontend/backend? does an empty lookup break a feature?

## Two classes of lookup

1. **DB-table lookups** (rows that must be *seeded/created*): `Category`,
   `JobCategory`. These are the only reference datasets that can be "empty in
   production" and cause breakage. Everything else is compiled-in.
2. **Shared-enum vocabularies** (`packages/shared/src/*.ts`, each mirrored 1:1 by a
   Prisma `enum`): employment types, work arrangement, experience/education level,
   salary period, property types, listing purpose, furnishing, tenure, area units,
   agent specialties, districts, vehicle types, review report reasons, promotion
   placements/types, campaign statuses, notification categories, role required
   documents. These **cannot be empty** — they ship in the bundle and are imported
   by API, web and admin from the same source of truth, so labels never drift. The
   audit risk for these is limited to *label wording*, not *missing data*.

Per-vendor operational data such as `DeliveryZone` / `DeliveryRate` is **not** a
managed global lookup; each vendor authors its own rows in delivery settings. It is
listed at the bottom for completeness.

## Inventory table

| Dataset | Source (table / enum) | Seeded? | Prod rows likely? | Public API | Form uses | Admin-managed | Risk if empty | Status |
|---|---|---|---|---|---|---|---|---|
| **Marketplace categories** | DB table `categories` (`Category`, schema.prisma:922) | **No** — absent from `seed.ts`; no data migration seeds it | **Unknown / must verify** — only rows an admin manually created via the category manager | `GET /marketplace/categories` (public, visible tree) — `categories.controller.ts` | Yes — vendor `ProductForm.tsx` category picker; `/products` category sidebar; homepage shop-by-category (M21) | Yes — `/dashboard/categories`, perm `categories.manage` (`admin-categories.controller.ts`) | Products can't be categorized; category browse + homepage "shop by category" render empty; product filters degrade | **GAP** — no automated seed; if prod table is empty the browse/filter surfaces are blank. Verify prod has rows or add a baseline seed (mirror the job-category approach). |
| **Job categories** | DB table `job_categories` (`JobCategory`, schema.prisma:2509) | **Being fixed** — new migration `20260915120000_seed_job_categories` inserts 20 baseline rows, idempotent `ON CONFLICT (slug) DO NOTHING` | **Empty in prod today** → non-empty after the lead's migration deploys | `GET /jobs/categories` (public) — `jobs-public.controller.ts:50` | Yes — `/jobs` filter + employer job editor category select | Yes — admin Jobs → **Categories** tab, perm `job_categories.manage` (`admin-jobs.controller.ts:53-58`, `jobs/page.tsx` CategoriesTab) | Job filter offers no categories; employer editor can't categorize; category facet empty | **GAP (in progress — lead)** — do not touch; tracked by the seed migration above. |
| **Employment types** | Shared enum `EMPLOYMENT_TYPES` (`jobs.ts:7`) ↔ Prisma `EmploymentType` (schema:2372) | N/A (compiled-in) | Always present | Values flow through job DTOs; labels from `EMPLOYMENT_TYPE_LABELS` | Yes — job editor + `/jobs` filter | No (code-level) | Cannot be empty | OK |
| **Work arrangement** | `WORK_ARRANGEMENTS` (`jobs.ts:14`) ↔ `WorkArrangement` (2383) | N/A | Always | Via job DTOs; `WORK_ARRANGEMENT_LABELS` | Yes | No | Cannot be empty | OK |
| **Experience levels** | `EXPERIENCE_LEVELS` (`jobs.ts:18`) ↔ `ExperienceLevel` (2389) | N/A | Always | `EXPERIENCE_LEVEL_LABELS` | Yes | No | Cannot be empty | OK |
| **Education levels** | `EDUCATION_LEVELS` (`jobs.ts:24`) ↔ `EducationLevel` (2398) | N/A | Always | `EDUCATION_LEVEL_LABELS` | Yes | No | Cannot be empty | OK |
| **Salary period** | `SALARY_PERIODS` (`jobs.ts:31`) ↔ `SalaryPeriod` (2409) | N/A | Always | `SALARY_PERIOD_LABELS` | Yes | No | Cannot be empty | OK |
| **Salary visibility** | `SALARY_VISIBILITIES` (`jobs.ts:35`) ↔ `SalaryVisibility` (2417) | N/A | Always | enum | Yes (job editor) | No | Cannot be empty | OK |
| **Job report reasons** | `JOB_REPORT_REASONS` (`jobs.ts:94`) ↔ `JobReportReason` (2491) | N/A | Always | enum | Yes (report dialog) | No (values); admin resolves reports | Cannot be empty | OK |
| **Property types** | `PROPERTY_TYPES` (`realestate.ts:11`) ↔ `PropertyType` (2926) | N/A | Always | `PROPERTY_TYPE_LABELS` | Yes — property editor + `/properties` filter | No | Cannot be empty | OK |
| **Listing purpose** | `LISTING_PURPOSES` (`realestate.ts:7`) ↔ `ListingPurpose` (2921) | N/A | Always | `LISTING_PURPOSE_LABELS` | Yes | No | Cannot be empty | OK |
| **Furnishing** | `FURNISHINGS` (`realestate.ts:27`) ↔ `Furnishing` (2960) | N/A | Always | `FURNISHING_LABELS` | Yes | No | Cannot be empty | OK |
| **Tenure** | `TENURES` (`realestate.ts:31`) ↔ `Tenure` (2967) | N/A | Always | enum | Yes | No | Cannot be empty | OK |
| **Area units** | `AREA_UNITS` (`realestate.ts:43`) ↔ `AreaUnit` (2988) | N/A | Always | `AREA_UNIT_LABELS` | Yes | No | Cannot be empty | OK |
| **Rental period** | `RENTAL_PERIODS` (`realestate.ts:39`) ↔ `RentalPeriod` (2981) | N/A | Always | `RENTAL_PERIOD_LABELS` | Yes | No | Cannot be empty | OK |
| **Location visibility** | `LOCATION_VISIBILITIES` (`realestate.ts:34`) ↔ `LocationVisibility` (2974) | N/A | Always | enum (default `DISTRICT_ONLY`) | Yes | No | Cannot be empty | OK |
| **Agent specialties** | `AGENT_SPECIALTIES` (`realestate.ts:47`) ↔ `AgentSpecialty` (2995) | N/A | Always | `AGENT_SPECIALTY_LABELS` | Yes (agent profile) | No | Cannot be empty | OK |
| **Property document kinds** | `PROPERTY_DOCUMENT_KINDS` (`realestate.ts:54`) ↔ `PropertyDocumentKind` (3006) | N/A | Always | enum | Yes (doc upload) | No | Cannot be empty | OK |
| **Property report reasons** | `PROPERTY_REPORT_REASONS` (`realestate.ts:87`) ↔ `PropertyReportReason` (3051) | N/A | Always | enum | Yes (report dialog) | admin resolves | Cannot be empty | OK |
| **Belize districts** | `DISTRICTS` (`districts.ts:2`) ↔ Prisma `District` (schema:36) | N/A | Always (6 fixed) | `DISTRICT_LABELS` | Yes — job filter, property filter, delivery zones, addresses | No | Cannot be empty | OK |
| **Vehicle types** | Prisma enum `VehicleType` (schema:1728) | N/A | Always | via driver DTOs | Yes — driver vehicle form | No | Cannot be empty | OK |
| **Review report reasons** | `REVIEW_REPORT_REASONS` (`reviews.ts:15`) ↔ `ReviewReportReason` (312) | N/A | Always | enum | Yes (review report dialog) | admin resolves | Cannot be empty | OK |
| **Review subject/context/status** | `reviews.ts:6,9,12` ↔ Prisma enums (293-327) | N/A | Always | enum | internal | admin moderates | Cannot be empty | OK |
| **Promotion types** | `PROMOTION_TYPES` (`marketing.ts:10`) ↔ `PromotionType` (3476) | N/A | Always | `PROMOTION_TYPE_LABELS` | Yes (promotion editor) | admin moderates | Cannot be empty | OK |
| **Promotion placements** | `PROMOTION_PLACEMENTS` (`marketing.ts:98`) ↔ `PromotionPlacementType` (3517) | N/A | Always | `PROMOTION_PLACEMENT_LABELS` | Yes (promotion editor) | admin curates (`homepage.manage`) | Cannot be empty | OK |
| **Promotion target types** | `PROMOTION_TARGET_TYPES` (`marketing.ts:71`) ↔ `PromotionTargetType` (3504) | N/A | Always | `PROMOTION_TARGET_TYPE_LABELS` | Yes | admin | Cannot be empty | OK |
| **Promotion asset kinds** | `PROMOTION_ASSET_KINDS` (`marketing.ts:139`) | N/A | Always | labels | Yes (media upload) | admin | Cannot be empty | OK |
| **Campaign types** | `CAMPAIGN_TYPES` (`marketing.ts:180`) ↔ `CampaignType` (3457) | N/A | Always | `CAMPAIGN_TYPE_LABELS` | Yes (campaign editor) | admin | Cannot be empty | OK |
| **Campaign statuses** | `CAMPAIGN_STATUSES` (`marketing.ts:192`) ↔ `CampaignStatus` (3467) | N/A | Always | `CAMPAIGN_STATUS_LABELS` + transition map | Yes (status control) | admin | Cannot be empty | OK |
| **Coupon discount types / scopes / statuses** | `marketing.ts:217-231` | N/A | Always | labels | Yes (coupon editor) | admin (`coupons.manage`) | Cannot be empty | OK |
| **Promotion report reasons** | `PROMOTION_REPORT_REASONS` (`marketing.ts:166`) | N/A | Always | labels | Yes | admin resolves | Cannot be empty | OK |
| **Notification categories** | Prisma enum `NotificationCategory` (schema:109) | N/A | Always (15 values) | notification preferences UI | Yes — `/dashboard/notifications/preferences` | No | Cannot be empty | OK |
| **Roles catalog** | `Role` table seeded from `ROLE_DEFINITIONS` (`roles.ts`) | **Yes** — `seed.ts seedRoles()` upserts every `ROLE_CODES` entry | Yes | via `/me` / role endpoints | Yes (role switcher, apply-for-role) | admin reviews applications | Role list empty (blocked by seed) | OK |
| **Role required documents** | Label arrays on `ROLE_DEFINITIONS[].requiredDocuments` (`roles.ts:53-145`) | N/A (labels only, compiled-in) | Always | surfaced in `/dashboard/roles` apply flow | Yes — document-upload checklist | No | Cannot be empty | OK |
| **Wallet account types** | `WALLET_ACCOUNT_TYPES` (shared) | **Yes** — `seed.ts seedSystemWalletAccounts()` creates each system account | Yes | internal | n/a | n/a | System counter-parties missing (blocked by seed) | OK |
| _Delivery zones_ (not a global lookup) | DB table `delivery_zones` (`DeliveryZone`, schema:1080) | No — **by design**; each vendor authors zones in delivery settings | Per-vendor | via vendor delivery settings API | Yes — `/dashboard/delivery` | No (vendor-owned, not platform lookup) | That vendor offers no delivery until it configures zones (intended) | OK (vendor data, not a managed lookup) |

## Flagged gaps (summary)

1. **`Category` (marketplace categories) has no automated seed.** — `seed.ts` seeds
   roles, wallet accounts and the super-admin only; no data migration seeds
   `categories`. Production rows exist only if an admin manually created them via
   `/dashboard/categories`. **Action:** confirm prod `categories` is non-empty; if
   not, add a baseline seed mirroring the job-category migration pattern
   (`INSERT … ON CONFLICT (slug) DO NOTHING`). If empty, `/products` category
   sidebar, homepage "shop by category" (M21) and the vendor product-category
   picker all degrade to empty. **Severity: high** (public browse surface).

2. **`JobCategory` (job categories) — empty in prod, fix already in flight.** —
   Migration `20260915120000_seed_job_categories` seeds 20 baseline categories,
   idempotently. **Owned by the lead; do not touch.** Listed here only for
   completeness. Once deployed, closes the empty-filter gap on `/jobs` and the
   employer job editor.

3. **No general observed label drift.** Every enum vocabulary is defined once in
   `packages/shared/src/*` and imported by API + web + admin, with the Prisma enum
   mirroring the shared array; `*_LABELS` maps are the single display source. This
   is a structural strength — the only real "empty lookup" risk is the two DB
   tables above.
