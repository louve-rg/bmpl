# Route Hierarchy & Breadcrumb Standard

_Read-only platform-quality audit. Generated 2026-08-02. Canonical navigation
contract for the whole BMPL platform (`apps/web` + `apps/admin`)._

Sources: full route trees under `apps/web/app/**` and `apps/admin/app/**`, the
shared `Breadcrumbs` component (`apps/web/components/ui.tsx:229`), and
`docs/phase-2/ROUTE-INVENTORY.md`.

---

## 1. Canonical route hierarchy

### Public web (`apps/web`)

```
/  (Home)
├── /products                     Marketplace catalog (a.k.a. "Shop")
│   └── /products/[slug]          Product detail (variants are UI, not routes)
├── /vendors                      Store directory ("All stores")
│   └── /store/[slug]             Storefront
├── /cart → /checkout             Cart → Checkout
├── /orders → /orders/[id]        Customer orders
├── /payments → /payments/[id]    Payments
├── /wishlist                     Saved products (M20)
├── /jobs                         Belize Connect — jobs
│   └── /jobs/[slug]              Job detail
│       (companies) /companies/[slug]   Employer public page
├── /properties                   Real Estate search
│   ├── /properties/[slug]        Property detail
│   ├── /properties/agents/[slug] Agent public profile
│   └── /properties/agencies/[slug] Agency public profile
└── /dashboard                    Role dashboards (see role-scoped tree)
```

There are **no product-variant routes** — a variant is state within
`/products/[slug]`. Any "sibling variant" navigation must stay on that URL
(query/hash or client state), never a new page.

### Admin (`apps/admin`)

```
/dashboard                        Overview
├── ops · notifications · support · reviews
├── jobs · properties · marketing         (module consoles)
├── applications → applications/[id]
├── users → users/[id]
├── vendors → vendors/[id]
├── drivers → drivers/[id]
├── dispatch → dispatch/[id]
├── products → products/[id]
├── orders → orders/[id]
├── payments → payments/[id]
├── wallet · settlements · analytics · categories · audit
```

Admin nav (`AdminShell.tsx` `NAV`, 21 entries) is a flat sidebar in **1:1**
correspondence with the section pages; detail pages (`[id]`) are reached by
drill-down.

---

## 2. Breadcrumb chains (target standard)

Each detail surface should present a breadcrumb trail whose links are all real
ancestor levels, the last item being the current (non-link) page. The shared
`Breadcrumbs` component already implements the correct semantics (accessible
`nav[aria-label="Breadcrumb"]`, last item `aria-current="page"`, ancestor links,
no reliance on browser history — good for direct/shared links).

| Section | Canonical breadcrumb chain |
|---|---|
| Marketplace — storefront | `Home → Stores → {Store}` |
| Marketplace — product | `Home → Stores → {Store} → {Product}` |
| Marketplace — catalog | `Home → Marketplace (Shop)` |
| Jobs — list | `Home → Belize Connect → Jobs` |
| Jobs — detail | `Home → Belize Connect → Jobs → {Category?} → {Job}` |
| Jobs — company | `Home → Belize Connect → Jobs → {Company}` |
| Real Estate — list | `Home → Real Estate → {For sale \| For rent?}` |
| Real Estate — property | `Home → Real Estate → {Listing type} → {Property}` |
| Real Estate — agent/agency | `Home → Real Estate → Agents → {Agent}` (fallback `Home → Real Estate → {Agent}` if no agents index) |
| Business dashboards (marketing) | `Dashboard → Marketing → {Promotions\|Campaigns\|Coupons} → {Entity}` |
| Role dashboards (generic) | `Dashboard → {Section} → {Entity}` |
| Admin | `Admin → {Module} → {Entity} → {Action?}` |

> **Current adoption:** the **Marketplace** section already renders the shared
> `Breadcrumbs` component on `/vendors`, `/store/[slug]` and `/products/[slug]`
> (the lead's in-flight fix). **Jobs, Real Estate, all role dashboards, and the
> entire admin app do NOT render breadcrumbs** — they rely on a single one-level-up
> back-link per page. Extending `Breadcrumbs` to those sections is the main
> convergence work.

---

## 3. Rules

1. **Back controls must name their destination.** Never a bare "Back"; never a
   misleading label (e.g. an arrow labelled "Shop" that actually returns to a
   product list, or "Jobs" that could be read as the public jobs board when it
   targets an employer's own list). Use the pattern `← {Destination name}` —
   e.g. `← Back to {Store}`, `← All stores`, `← Store orders`.
2. **Breadcrumb links must not drop required context.** A child of a scoped parent
   (agent profile, agency profile, company page, a category-filtered job list)
   must link back to that parent, not jump straight to the unscoped root.
3. **Detail pages preserve origin where practical.** Derive the breadcrumb trail
   from the entity's own data (e.g. product → its vendor) so it is correct even for
   a link opened cold, then offer a primary back that returns exactly one logical
   level.
4. **Direct links must have safe fallback breadcrumbs.** Because trails are derived
   from entity data (not history), a shared/bookmarked URL still renders a complete,
   correct chain. Where no true parent index exists (e.g. no companies index, no
   agents index), fall back to the nearest real ancestor and keep the label honest.
5. **Browser history and visible breadcrumbs must not conflict.** The visible
   back-control and breadcrumb must point to the *content* parent, never
   `history.back()` semantics that could land the user on an unrelated page. Mobile
   JS-only back buttons (state toggles) must still expose an `aria-label` naming the
   destination.
6. **Pagination is not navigation-back.** `← Prev` / `Next →` controls must be
   visually and semantically distinct from the back-control so users don't confuse
   "previous page of results" with "go up a level".
7. **One back-control per view.** Avoid rendering the same back-link multiple times
   in a single page (see driver job detail below).

---

## 4. Observed back-control inventory (per section)

Labels/targets observed in the current tree. "Correct?" measured against the rules
above. (Verified against the live files; the marketplace product page already
carries the lead's fix.)

### Marketplace (web)

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Product detail | `app/products/[slug]/page.tsx:43` | `← Back to {Store}` + Breadcrumbs `Stores → {Store} → {Product}` | `/store/[slug]` | ✅ (lead's fix — do not touch) |
| Storefront | `app/store/[slug]/page.tsx:37` | `← All stores` + Breadcrumbs | `/vendors` | ✅ |
| Store directory | `app/vendors/page.tsx:36` | Breadcrumbs `Home → Stores` | — | ✅ |
| Cart | `app/cart/page.tsx:165` | `Continue shopping` | `/products` | ✅ |
| Checkout | `app/checkout/page.tsx:328` | `Back to cart` | `/cart` | ✅ |
| Order detail | `app/orders/[id]/page.tsx:48` | `← Your orders` | `/orders` | ✅ |
| Payment detail | `app/payments/[id]/page.tsx:57` | `← Payments` | `/payments` | ✅ |
| Vendor product edit | `app/dashboard/products/[id]/page.tsx:106` | `← My Products` | `/dashboard/products` | ✅ |
| Store orders detail | `app/dashboard/orders/[id]/page.tsx:34` | `← Store orders` | `/dashboard/orders` | ✅ |

### Jobs / Belize Connect (web)

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Jobs list | `app/jobs/page.tsx` | (eyebrow "Belize Connect", no breadcrumb) | — | ⚠️ no breadcrumb trail |
| Job detail | `app/jobs/[slug]/page.tsx:57` | `← All jobs` | `/jobs` | ⚠️ correct target but no breadcrumb / no category context |
| Company page | `app/companies/[slug]/page.tsx:105` | `← Browse all jobs` | `/jobs` | ⚠️ acceptable (no companies index) but drops company context |
| Employer job editor | `app/dashboard/employer/jobs/[id]/page.tsx:84` | `← Jobs` | `/dashboard/employer/jobs` | ⚠️ ambiguous — reads like public `/jobs`; label "Job Listings" clearer |
| Employer new job | `app/dashboard/employer/jobs/new/page.tsx:10` | `← Jobs` | `/dashboard/employer/jobs` | ⚠️ same ambiguity |
| Employer applicant detail | `app/dashboard/employer/applications/[id]/page.tsx:75` | `← Applicants` | `/dashboard/employer/applications` | ✅ |
| Seeker application detail | `app/dashboard/jobs/applications/[id]/page.tsx:67` | `← My applications` | `/dashboard/jobs/applications` | ✅ |

### Real Estate (web)

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Property list | `app/properties/page.tsx` | (no breadcrumb) | — | ⚠️ no breadcrumb trail |
| Property detail | `app/properties/[slug]/page.tsx:54` | `← All properties` | `/properties` | ⚠️ correct target but no breadcrumb / no listing-type context |
| Agent profile | `app/properties/agents/[slug]/page.tsx:104` | `← Browse all properties` | `/properties` | ❌ drops agent context; should be `Real Estate → Agents → {Agent}` |
| Agency profile | `app/properties/agencies/[slug]/page.tsx:119` | `← Browse all properties` | `/properties` | ❌ drops agency context |
| Seeker enquiry detail | `app/dashboard/properties/enquiries/[id]/page.tsx:52` | `← My enquiries` | `/dashboard/properties/enquiries` | ✅ |
| Owner/agent listing detail | `components/realestate/ListingManager.tsx:116` | `← Listings` | list path prop | ✅ (correct per-role list) |
| Owner/agent enquiry detail | `components/realestate/ListerEnquiries.tsx:168` | `← Enquiries` | list path prop | ✅ |
| Owner new listing | `app/dashboard/property-owner/listings/new/page.tsx:20` | `← Listings` | `/dashboard/property-owner/listings` | ✅ |

### Business / Marketing dashboards (web)

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Campaign detail | `app/dashboard/business/marketing/campaigns/[id]/page.tsx:70` | `Back to campaigns` | `.../campaigns` | ✅ (add breadcrumb for depth) |
| Promotion detail | `app/dashboard/business/marketing/promotions/[id]/page.tsx:118` | `Back to promotions` | `.../promotions` | ✅ |
| New promotion | `app/dashboard/business/marketing/promotions/new/page.tsx:88` | `Cancel` | `.../promotions` | ✅ (cancel = back) |

### Driver dashboard (web)

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Driver earnings | `app/dashboard/driver/earnings/page.tsx:100` | `← Driver` | `/dashboard/driver` | ⚠️ terse |
| Driver job detail | `app/dashboard/driver/jobs/[id]/page.tsx:146,158,168` | `Back to deliveries` ×3 | `/dashboard/driver/jobs` | ❌ same control rendered three times (rule 7) |
| Messages (mobile) | `app/dashboard/messages/page.tsx:363,768` | icon-only, `aria-label="Back to conversations"` | JS state | ✅ (has aria-label) |
| Notification prefs | `app/dashboard/notifications/preferences/page.tsx:57` | `← Back to notifications` | `/dashboard/notifications` | ✅ |

### Admin

No breadcrumb component exists in admin. Each `[id]` detail page has one back-link
to its parent list, but wording is inconsistent:

| Page | File:line | Label | Target | Correct? |
|---|---|---|---|---|
| Application detail | `app/dashboard/applications/[id]/page.tsx:40` | `← Back to queue` | `/dashboard/applications` | ✅ |
| User detail | `app/dashboard/users/[id]/page.tsx:32` | `← Back to users` | `/dashboard/users` | ✅ |
| Vendor detail | `app/dashboard/vendors/[id]/page.tsx:39` | `← Vendors` | `/dashboard/vendors` | ⚠️ terse |
| Driver detail | `app/dashboard/drivers/[id]/page.tsx:96` | `← Drivers` | `/dashboard/drivers` | ⚠️ terse |
| Dispatch detail | `app/dashboard/dispatch/[id]/page.tsx:127` | `← Dispatch` | `/dashboard/dispatch` | ⚠️ terse |
| Product detail | `app/dashboard/products/[id]/page.tsx:43` | `← Products` | `/dashboard/products` | ⚠️ terse |
| Order detail | `app/dashboard/orders/[id]/page.tsx:84` | `← Orders` | `/dashboard/orders` | ⚠️ terse |
| Payment detail | `app/dashboard/payments/[id]/page.tsx:49` | `← Payments` | `/dashboard/payments` | ⚠️ terse |

**Admin standardization:** adopt `Admin → {Module} → {Entity}` breadcrumbs and a
consistent `← Back to {module}` label across all detail pages.

---

## 5. Priority convergence list

1. Add `Breadcrumbs` to **Jobs** and **Real Estate** detail + list pages (chains in
   §2). _(Marketplace already done by the lead.)_
2. Fix **context-dropping** backs on agent/agency profiles (❌ rows).
3. De-duplicate the three "Back to deliveries" controls on the driver job detail.
4. Disambiguate employer `← Jobs` → `← Job Listings`.
5. Standardize admin detail back-labels + add admin breadcrumbs.
