# Production Manual QA Checklist

_Runnable manual QA pass for an operator, executed against production. Generated
2026-08-02. Grouped by the 30 roadmap modules (M0–M26, incl. M6.1/M6.2/M18.1)._

## Environments

| Surface | URL |
|---|---|
| Web (public + role dashboards) | `https://bmpl-web.vercel.app` |
| Admin console | `https://bmpl-admin.vercel.app` |
| API | `https://bmplapi-production.up.railway.app` |

## Audit dimensions checked in every module

Navigation / back / breadcrumbs · data completeness & empty states · workflow
continuity · state sync · mobile · no dead-ends.

## Legend

- **[M]** = can only be verified manually (visual / cross-surface / prod-data).
- **[A]** = has automated test coverage (unit/integration/e2e in `apps/api/test` or
  package tests); still spot-check in prod but regression is guarded.
- **Expected:** the pass condition.

---

## M0 — Shared foundation / auth & roles

- [M] Register a new account → verify email link works → sign in. **Expected:** land
  on `/dashboard`; role switcher shows CUSTOMER.
- [M] `/dashboard/roles` → apply for VENDOR → required-document checklist matches the
  role (Government ID, Business registration). **Expected:** upload works, status
  shows PENDING. **[A]** role-application state machine is unit-tested.
- [M] Forgot password → `Back to sign in` link returns to `/login`. **Expected:** no
  dead-end.

## M1 — Marketplace categories

- [M] **Data completeness (GAP):** `/products` category sidebar and homepage
  "shop by category" — confirm categories render. **Expected:** non-empty. If empty,
  the `categories` table was never seeded (see LOOKUP-DATA-INVENTORY §gap 1).
- [M] Admin `/dashboard/categories` → create/reorder/hide a category. **Expected:**
  hidden category disappears from public sidebar (state sync).

## M2 — Vendor profiles

- [M] Admin `/dashboard/vendors` → open a PENDING vendor → approve. **Expected:**
  storefront becomes public at `/store/[slug]`; `← Vendors` back returns to queue.
- [M] Empty state: `/vendors` with no live stores shows "No storefronts are live
  yet." (`vendors/page.tsx:49`). **Expected:** friendly empty state, no error.

## M3 — Vendor storefront

- [M] **Mandatory marketplace hierarchy walk** (see dedicated section below).
- [M] `/dashboard/store` → edit profile/hours/logo → `/dashboard/store/preview`
  round-trips via `← Back to My Store`. **Expected:** no dead-end.

## M4 — Products

- [M] `/products` search + category filter + price/in-stock filter + sort +
  pagination. **Expected:** filters combine; `← Prev`/`Next →` are pagination (not
  back). **[A]** marketplace search is unit-tested (`marketplace.test.ts`).
- [M] Empty state: search with no matches → "No products found." (`products/page.tsx:170`).

## M5 — Product images

- [M] Vendor `/dashboard/products/[id]` image manager: upload, reorder, set primary.
  **Expected:** primary image shows on `/products/[slug]` gallery (state sync).

## M6 — Inventory & variants

- [M] Product with options → `/products/[slug]` shows variant selector; out-of-stock
  variant is disabled. **Expected:** availability reflects inventory. **[A]** variant
  availability logic is tested (M6.2).

## M6.1 — Variant image workflow

- [M] Assign an image to a specific variant → selecting that variant swaps the gallery
  image. **Expected:** variant-scoped image displays.

## M6.2 — Marketplace variant availability

- [M] Set one variant to zero stock in vendor editor → public product page marks it
  unavailable without a page rebuild wait (force refresh if needed). **Expected:**
  state sync between vendor edit and public view.

## M7 — Marketplace search

- [M] Typeahead/search on `/products`; category sidebar; `vendorSlug` single-store
  view. **Expected:** results correct; single-store view scoped. **[A]** search tested.

## M8 — Hardening

- [M] Public list pages under API outage render "temporarily unavailable", never a
  Next 500 (`serverGetSafe`). **Expected:** graceful degrade.

## M9 — Shopping cart

- [M] Add to cart as guest → prompted to sign in with `?next=` bounce-back →
  after login returns to intended page. **Expected:** cart persists; `Continue
  shopping` → `/products`. **[A]** cart/reservation tested (`dispatch.integration`).

## M10 — Checkout & orders

- [M] `/cart` → `/checkout` (`Back to cart` works) → place order → `/orders/[id]`.
  **Expected:** order created; timeline visible; `← Your orders` back correct.
  **[A]** order/reservation-release migration + service tested.

## M11 — Payments & wallet

- [M] Complete a payment on checkout → `/payments/[id]` shows status; `← Payments`
  back. **Expected:** payment recorded. **[A]** payments/wallet-hold escrow tested.

## M12 — Wallet authorization / escrow

- [M] Admin `/dashboard/wallet` and `/dashboard/settlements` → internal balances
  reconcile (double-entry). **Expected:** no orphan holds. **[A]** settlement tested.

## M13 — Delivery foundation

- [M] Vendor `/dashboard/delivery` → add a delivery zone (districts) + fee + estimate.
  **Expected:** zone saved; **empty until configured is by design** (per-vendor data,
  not a platform lookup). Checkout for a covered district shows the fee.

## M14 — Driver management

- [M] `/dashboard/driver` → complete driver profile, add vehicle (VehicleType select),
  service areas → submit. Admin `/dashboard/drivers/[id]` → approve vehicle.
  **Expected:** approval reflected; `← Drivers` back. **[A]** driver actions audited.

## M15 — Dispatch & delivery execution

- [M] Admin `/dashboard/dispatch` → open a delivery → assign eligible driver.
  Driver `/dashboard/driver/jobs/[id]` → accept → pickup PIN → in-transit → delivery
  PIN + POD upload. Customer `/orders/[id]` → tracking timeline + PIN reveal + POD.
  **Expected:** state syncs across admin/driver/customer. **Note:** driver job detail
  currently renders three identical "Back to deliveries" controls — cosmetic, not
  blocking. **[A]** dispatch integration-tested.

## M16 — Notifications event system

- [M] Trigger an order event → `/dashboard/notifications` shows it; filter by category;
  mark read/dismiss; `/dashboard/notifications/preferences` toggles per category
  (`NotificationCategory`), `← Back to notifications` works. **Expected:** state sync.

## M17 — Messaging / order communication

- [M] `/dashboard/messages` → open an order/delivery conversation → send message +
  attachment. Mobile: `Back to conversations` (icon, aria-labelled) returns to list.
  Admin `/dashboard/support` → join/reply/internal note/close. **Expected:** unread
  badge on Sidebar Messages updates. **[A]** messaging integration-tested.

## M18 — Settlement & earnings

- [M] Vendor `/dashboard/settlements` → pending/posted totals + breakdown. Driver
  `/dashboard/driver/earnings` → totals + history (`← Driver` back). **Expected:**
  figures reconcile with admin settlements. **[A]** settlement tested.

## M18.1 — Pickup fulfilment

- [M] Order flagged pickup (not delivery) → fulfilment flow completes without a
  delivery/driver step. **Expected:** no dead-end where a delivery step is expected.

## M19 — Reviews & ratings

- [M] After a completed order, leave a product/vendor/driver review from `/orders/[id]`
  or `/dashboard/reviews`. **Expected:** verified review appears on `/products/[slug]`
  and `/store/[slug]` aggregates. Report a review → admin `/dashboard/reviews` resolves.
  **[A]** review aggregation tested (`reviews.test.ts`).

## M20 — Saved products / recently viewed

- [M] Save a product (heart) → `/wishlist` grid + recently-viewed strip; remove works;
  empty state `Browse the marketplace` → `/products`. **Expected:** no dead-end.

## M21 — Discovery & recommendations

- [M] Homepage `/` rows: featured / top-rated / new arrivals / popular / shop-by-category.
  `/dashboard` "recommended for you". **Expected:** rows populate or degrade cleanly if
  data sparse (watch shop-by-category if `categories` unseeded — see M1).

## M22 — Analytics & reporting

- [M] Vendor `/dashboard/analytics` and admin `/dashboard/analytics` → KPIs, sales
  chart, top products/vendors, orders CSV export downloads. **Expected:** export
  produces a file; charts render with real figures.

## M23 — Platform operations

- [M] Admin `/dashboard/ops` → cross-domain action queues, announcement/maintenance
  editor (`ops.manage`), audit CSV export (`audit.read`). **Expected:** announcement
  set here surfaces platform-wide. Admin `/dashboard/audit` → audit log renders.

## M24 — Belize Connect (Jobs)

- [M] **Mandatory jobs-category walk** (see dedicated section below).
- [M] `/jobs/[slug]` → apply (internal/external/email per listing); save; report.
  Company `/companies/[slug]` → `← Browse all jobs`. **Expected:** application lands
  in employer pipeline. **Note:** jobs pages have **no breadcrumb trail** — only
  `← All jobs`; navigation still works but context is thin.
- [M] Employer `/dashboard/employer/jobs` → create/edit job (`← Jobs` back is
  ambiguous but functional) → `/dashboard/employer/applications` pipeline transitions
  (Submitted → Shortlisted → … → Hired/Rejected). **[A]** application transition map
  is unit-tested.
- [M] Admin `/dashboard/jobs` → Moderation / Reports / Employers / **Categories** /
  Analytics tabs. **Expected:** Categories tab lists the seeded categories.

## M25 — Real Estate

- [M] `/properties` → filter (purpose, type, district, price, beds/baths, furnishing,
  sort). Empty state "No properties match your search" (`properties/page.tsx:88`).
- [M] `/properties/[slug]` → gallery, key facts, amenities, location per visibility
  (never exact address unless allowed), agent/agency card, save/enquiry/viewing/report.
  `← All properties` back. **Note:** no breadcrumb; agent/agency profile backs
  (`/properties/agents/[slug]`, `/agencies/[slug]`) go to `/properties` and **drop the
  agent/agency context** — flag.
- [M] Owner `/dashboard/property-owner/listings` → create listing, upload images/docs,
  assign agent. Agent `/dashboard/real-estate-agent/assignments` → accept/decline →
  listing appears under managed listings. **Expected:** assignment state syncs across
  owner ↔ agent. Admin `/dashboard/properties` moderates. **[A]** viewing/enquiry
  transition maps tested.

## M26 — Marketing & business promotion

- [M] Business `/dashboard/business/marketing` → create campaign, promotion
  (placements/targets/media), vendor coupon. `Back to campaigns` / `Back to promotions`
  works. **Expected:** submitted promotion enters admin queue.
- [M] Admin `/dashboard/marketing` → moderate promotion (approve) → it renders as an
  **additive** "Sponsored/Featured" band on `/` without reordering organic results.
  **Expected:** organic ranking unchanged; homepage hero/featured bands populate.
  **[A]** promotion serveability/status transitions tested.

---

## MANDATORY WALK 1 — Marketplace hierarchy

Run on desktop **and** mobile.

1. `/vendors` (**All stores**) — breadcrumb `Home → Stores`. Directory lists live
   stores; empty state if none. **[M]**
2. Open a store → `/store/[slug]` (**Storefront**) — breadcrumb
   `Home → Stores → {Store}`; `← All stores` returns to `/vendors`. **[M]**
3. Open a product → `/products/[slug]` (**Product**) — breadcrumb
   `Stores → {Store} → {Product}`; primary back `← Back to {Store}` returns to the
   **originating storefront** (NOT the all-products list). _(Lead's fix — confirm it
   is live.)_ **[M]**
4. **Variant:** select a variant → sibling variants remain selectable and **persist**
   the selection while browsing options; URL stays on `/products/[slug]` (variants are
   not separate routes). **[M]**
5. **Each back level correct:** product back → storefront; storefront back → all
   stores; breadcrumb links each go up exactly one level. **[M]**
6. **Direct variant URL:** open `/products/[slug]` cold (new tab / shared link) → the
   breadcrumb trail is still complete and correct (derived from product data, not
   history). **[M]**
7. **Refresh:** on the product page, hard-refresh → variant availability, gallery and
   breadcrumb re-render correctly; no 500, no lost context. **[M]**

## MANDATORY WALK 2 — Jobs category

1. `/jobs` → **categories are visible** in the filter (post-seed of `job_categories`;
   pre-seed this is empty — see LOOKUP-DATA-INVENTORY §gap 2). **[M]**
2. Select a category → **filter works** (results scoped to that category). **[M]**
3. Category filter **persists through pagination** (`← Prev`/`Next →`) and through a
   **sort** change. **[M]**
4. Employer `/dashboard/employer/jobs/[id]` editor → the category select shows the
   **same category list** as the public filter (single source: `GET /jobs/categories`).
   **[M]**
5. Admin `/dashboard/jobs` → **Categories** tab manages that same set. **[M]**

---

## Cross-cutting checks (run once, all surfaces)

- **No dead-ends:** every detail page has a working back-control; no page requires
  browser-back to escape. **[M]**
- **Empty states:** confirmed present on `/vendors`, `/products`, `/jobs`,
  `/properties`. Spot-check dashboard list pages (saved jobs/properties, enquiries,
  applications) for meaningful empties. **[M]**
- **Mobile:** sidebar collapses; message list ↔ thread back button works; tables
  scroll horizontally without breaking the page. **[M]**
- **State sync:** an admin action (approve vendor/driver, moderate job/property/
  promotion) is reflected on the corresponding public surface without a redeploy. **[M]**
- **Role discoverability:** confirm the role dashboard Sidebar shows only the modules
  the signed-in user is entitled to (note: driver links currently show for all users —
  see the UX-audit findings). **[M]**
