# M26.1 — Full Platform UX, Navigation & Completeness Audit

> **📅 Dated milestone record (banner added 2026-09-09).** Every statement below
> describes the repository as it stood at M26.1 — do not read scope lines as
> current. In particular, "Passenger Transportation not started" is **no longer
> true**: the passenger vertical is built end to end and the rider journey is
> verified (see [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) §1 and
> [`PASSENGER-LIFECYCLE.md`](../PASSENGER-LIFECYCLE.md)). For current state,
> always start from `PROJECT_STATUS.md`.

A product-quality pass over every implemented BMPL module (M0–M26). Focus: the
small-but-important issues automated tests miss — navigation, back behavior,
disappearing data, missing lookup/seed data, breadcrumbs, empty states, and
role-specific workflow gaps. Companion docs: [ROUTE-AND-BREADCRUMB-STANDARD](./ROUTE-AND-BREADCRUMB-STANDARD.md),
[LOOKUP-DATA-INVENTORY](./LOOKUP-DATA-INVENTORY.md), [PRODUCTION-MANUAL-CHECKLIST](./PRODUCTION-MANUAL-CHECKLIST.md).

## Executive summary
The platform is broadly solid: public list pages have friendly empty states, admin
navigation is a clean 1:1 with routes (no dead/undiscoverable admin pages), and enum
vocabularies are single-sourced in `packages/shared` (no frontend/backend label drift).
The audit found **two mandatory defects** (both now fixed) plus a handful of navigation
and discoverability issues. Every fix is backward-compatible, preserves existing URLs,
and changes no data, permissions, audit history, or financial logic.

The two mandatory issues had the same shape: **the code was correct but the last mile of
UX/data was missing.** Marketplace variant state was already correct — the bug was the
back control and missing breadcrumbs. Jobs category search was fully wired end-to-end —
the bug was zero seeded rows.

## Issues found (by severity)

### CRITICAL / mandatory (fixed)
| # | Module | Root cause | Fix | Tests |
|---|---|---|---|---|
| 1 | Marketplace | The product page's back control was hardcoded `<Link href="/products">← Shop</Link>` — it jumped to the all-products list regardless of the originating storefront, and there were no breadcrumbs. (Variant state was already correct: `?variant=` is shallow `history.replaceState`, siblings always render, cart uses the selected variant, refresh restores selection.) | New shared `Breadcrumbs` component + `lib/marketplace-nav.ts` single-source hierarchy (`Stores → Storefront → Product`). Product back now returns to `/store/{vendor.slug}` ("← Back to {store}"); breadcrumbs added to `/vendors`, `/store/[slug]`, `/products/[slug]`, derived from entity data so shared/direct links get a correct trail. | `apps/web/lib/marketplace-nav.test.ts` (5) — back returns to storefront not `/products`; breadcrumb hierarchy; current page unlinked. Variant state covered by `variant-availability.test.ts` (18). |
| 2 | Jobs | `JobCategory` table empty in production — `seed.ts` never seeded it and no data migration existed. The public `/jobs/categories` endpoint, the `SearchFilters` category dropdown, and the `EmployerJobForm` category select were all correctly wired to the same source; they just had no rows. | Idempotent data migration `20260915120000_seed_job_categories` (20 baseline Belize categories, `ON CONFLICT (slug) DO NOTHING`) — runs in prod via the Railway `preDeployCommand`. Same taxonomy added to `seed.ts` (`seedJobCategories`, upsert) for fresh dev/test. | `apps/api/test/job-categories.integration.spec.ts` (3) — 20 baseline seeded idempotently (no dupes on re-run); public exposure sorted with readable labels; category-slug filter works + clearing restores all. |

### HIGH (fixed)
| # | Module | Issue | Fix |
|---|---|---|---|
| 3 | Dashboard nav | `Driver` / `Deliveries` / `Earnings` were in the unconditional `BASE_NAV`, so every customer saw driver links leading to role-gated/empty pages (dead-ends). | Moved to a `DRIVER_NAV` group gated by `isDriver` (approved `DELIVERY_DRIVER`), mirroring the existing vendor/employer/owner/agent gating. |

### MEDIUM (fixed)
| # | Module | Issue | Fix |
|---|---|---|---|
| 4 | Wishlist (M20) | `/wishlist` had no dashboard link — saved products were only reachable via the product heart icon. | Added "Saved Products" → `/wishlist` to `BASE_NAV`. |
| 5 | Jobs / Real Estate | No breadcrumbs on `/jobs`, `/jobs/[slug]`, `/properties`, `/properties/[slug]`; only a single flat back link. | Breadcrumb trails added (Home → Belize Connect → Jobs → {title}; Home → Real Estate → {title}). |
| 6 | Real Estate | Agent/agency public pages' back control said "← Browse all properties" → `/properties`, dropping the agent/agency context and mislabeling. | Added a `Real Estate → {agent/agency}` breadcrumb; relabeled back to "← Back to Real Estate" (correct parent; no agents-index route exists). |

### LOW (fixed / documented)
| # | Module | Issue | Disposition |
|---|---|---|---|
| 7 | Driver | Three identical "Back to deliveries" links on the driver job detail page. | Reduced to one. |
| 8 | Employer | `← Jobs` back label reads like the public board. | Relabeled "← Job Listings". |
| 9 | Admin | Detail pages mix `← Back to queue` / bare `← Vendors` etc.; no admin breadcrumb component. | Documented in ROUTE-AND-BREADCRUMB-STANDARD as a recommended follow-up (broad surface, low impact; deferred to keep this milestone tight). |

## Findings by dimension
- **Navigation / back / breadcrumbs:** the marketplace hierarchy is the reference implementation; Jobs/RE now match. Admin breadcrumbs remain a documented follow-up. No dead-end pages remain in the audited flows; every back control names or implies its destination.
- **Data completeness / seed:** job categories were the one production data gap (fixed). Marketplace `Category` **is** populated in production (Electronics tree present) but has **no automated seed** — a fresh environment would start empty; recommended hardening is a baseline-category migration mirroring the job-category one (deferred; prod is healthy). All other lookups are compiled-in shared enums that cannot be "empty" (API/web/admin import the same source). See LOOKUP-DATA-INVENTORY.
- **Workflow continuity:** the audited create/submit/moderate flows (products, jobs, properties, promotions) complete end-to-end with clear status + reviewer notes; no hidden prerequisites without explanation.
- **State synchronization:** variant selection ⇄ URL ⇄ cart ⇄ title/image/price/SKU/stock is correct and test-locked; filters reflect URL query state on the public list pages.
- **Visual hierarchy / empty states:** all four public list pages (`/vendors`, `/products`, `/jobs`, `/properties`) have friendly empty states; dashboards use the BMPL design system.
- **Mobile:** the dashboard sidebar collapses; list/detail pages use responsive containers. No horizontal-overflow issues observed in the audited pages (full device-matrix checks are in the manual checklist).
- **Accessibility:** the new `Breadcrumbs` uses `nav[aria-label="Breadcrumb"]` + `aria-current="page"`; existing controls use semantic buttons/links. A full keyboard/focus sweep is listed as manual.
- **Performance / reliability:** navigation is client-side within the dashboard; the variant URL update is a shallow `replaceState` (no refetch); no full-page reloads introduced.

## Root causes (themes)
1. **Hardcoded/flat back links** instead of hierarchy-derived navigation → fixed by a single-source nav module + a shared breadcrumb component.
2. **Reference data seeded manually rather than via idempotent migrations** → job categories now seed via migration; marketplace categories flagged for the same hardening.
3. **Unconditional nav entries for role-gated routes** → fixed by role-gating the driver group.

## What was intentionally NOT changed
No rewrites of stable modules; no URL changes (only added breadcrumbs + corrected back targets/labels); no permission, audit, or financial changes; no production data reset; Passenger Transportation not started; no mobile app; no unrelated features.

## Remaining manual checks & deferred improvements
- Full mobile device-matrix + keyboard/focus/screen-reader sweep (see PRODUCTION-MANUAL-CHECKLIST — marked [M]).
- Admin breadcrumb component + standardized `← Back to {module}` labels (LOW; documented).
- Baseline marketplace-category seed migration for fresh environments (prod already populated).
- These are tracked in the companion docs; none blocks the platform.

## Deployment & production verification (2026-08-02)
Milestone commit `5ff74e4` on `main`. Railway API redeployed `--from-source` (live
commit **`5ff74e4`**); the job-category migration applied via `preDeployCommand`. Web +
admin auto-deployed on Vercel.

Verified live against `bmplapi-production` / `bmpl-web.vercel.app`:
- `health` → commit `5ff74e4`; `health/ready` → `200` (database/redis/storage healthy).
- **Jobs categories:** `GET /api/jobs/categories` → **20 baseline categories** (was `[]`);
  the live `/jobs` page renders a populated category dropdown (Healthcare, Information
  Technology, …); `/jobs?category=healthcare` → `200`. Employer editor uses the same source.
- **Marketplace hierarchy live:** `/vendors` shows Home → Stores breadcrumb; `/store/[slug]`
  shows the Stores breadcrumb + "← All stores"; `/products/[slug]` shows the Stores → {store}
  → {product} breadcrumb and "← Back to {store}" → `/store/{slug}`. The old "← Shop" → `/products`
  is **gone**. Direct product link renders the full parent product (variant state test-locked).
- **No regression:** `marketplace/products|categories|vendors`, `jobs`, `properties`,
  `marketing/homepage` all `200`; no `5xx`. Additive migration (`ON CONFLICT DO NOTHING`) —
  no data reset, no permission/audit/financial change.
- Local test-only MinIO stopped; no production test data created.
