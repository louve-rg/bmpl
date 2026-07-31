# Marketplace Client Demo Readiness (M12.1)

This milestone makes the existing marketplace demonstrable end-to-end with **real
production workflows** — no shortcuts, no seeded fakes, no admin backdoors. A
client can create an account, become an approved vendor with real documents, build
a storefront, list products, and have those products appear publicly for other
shoppers to browse and buy.

It does **not** extend the roadmap: no Phase 4 delivery/shipping, no new wallet or
payment behaviour, no payouts, settlement, refunds, disputes, logistics, jobs, real
estate, marketing, messaging, or reviews. It only closes demo-blocking gaps in
what already exists.

Related: [Demo checklist](./DEMO-CHECKLIST.md) ·
[Authorization model](../phase-2/AUTHORIZATION.md) ·
[API inventory](../phase-2/API-INVENTORY.md) ·
[M12 escrow](../phase-3/M12-wallet-authorization-escrow.md).

---

## 1. The hard rule

> **No one may place an order without logging into a customer account.**

This is enforced at the **API layer**, independent of the frontend. The web app
also guides guests to log in, but even a hand-crafted request cannot bypass it:

| Actor | Browsing public catalog | Cart / checkout / orders / payments / wallet |
|-------|-------------------------|----------------------------------------------|
| **Guest** (no session) | ✅ 200 | ⛔ **401 Unauthorized** |
| **Customer** (logged in) | ✅ 200 | ✅ allowed (self-scoped) |
| **Wrong role** (e.g. customer hitting vendor APIs) | ✅ 200 | ⛔ **403 Forbidden** |

The global NestJS guard chain is default-deny: `Throttler → CSRF → JwtAuthGuard →
RolesGuard → PermissionsGuard`. Only routes explicitly marked `@Public` (the
public marketplace + health) are reachable without a session. Purchase endpoints
carry `@Roles('CUSTOMER')`; vendor endpoints carry `@Roles('VENDOR')`.

Backend enforcement is locked by
[`apps/api/test/demo-readiness.integration.spec.ts`](../../apps/api/test/demo-readiness.integration.spec.ts)
(18 tests): guests browse the catalog, guests are 401 on every purchase endpoint,
a plain customer is 403 on vendor endpoints, and the vendor application enforces
its document requirement.

---

## 2. The demo journey (real workflow)

1. **Register** a customer account (`/register`) → auto-logged-in, gets an APPROVED
   `CUSTOMER` role and a BZD wallet.
2. **Browse** the public shop (`/products`) as that customer — or as a guest.
3. **Request the Vendor role** (`/dashboard/roles`): upload the required documents
   (government-issued ID + business registration/trade licence), submit for review.
4. **Admin reviews** (`/dashboard/applications` in the admin app): view documents,
   optionally **request more information**, then **approve** the role application.
5. **Applicant responds** to a more-info request if asked, and resubmits — the
   application returns to PENDING.
6. **Switch to Vendor** (`/dashboard` role switcher) once the role is APPROVED.
7. **Create a storefront** (`/dashboard/store`): business name, contact, locations,
   logo/banner. Submit the storefront; admin approves the **VendorProfile**.
8. **Add products** (`/dashboard/products`): title, description, category, images,
   price, inventory, variants. Publish.
9. **Products appear publicly** on `/products` and on the vendor's storefront
   (`/store/<slug>` and `/products?vendorSlug=<slug>`) for any shopper to browse.
10. **A shopper buys** (must be logged in as a customer): add to cart → checkout →
    authorize payment (M12 escrow). A guest attempting any of this is redirected to
    log in and returned to where they were headed via `?next=`.

### Two independent approval axes

Vendor onboarding has **two separate approvals** — approving one does not touch the
other:

- **VENDOR user role** — via `RoleApplication`
  (`PENDING → MORE_INFO_REQUIRED → APPROVED / REJECTED / WITHDRAWN`). Grants the
  ability to *act* as a vendor.
- **VendorProfile storefront** — `approvalStatus`
  (`DRAFT → PENDING → APPROVED / REJECTED / SUSPENDED`). Grants the storefront the
  ability to be *published*.

A customer keeps `CUSTOMER` as their active role while holding an approved `VENDOR`
role; `RolesGuard` checks *held-approved* roles, so vendor APIs work without
forcing a role switch.

---

## 3. Gaps closed in M12.1

| Area | Gap | Fix |
|------|-----|-----|
| Vendor application (web) | No document upload; posted `documentKeys: []`; no status detail; no more-info resubmit UI | Rebuilt [`/dashboard/roles`](../../apps/web/app/dashboard/roles/page.tsx): presign→PUT upload per required document, application list with status + reviewer notes, MORE_INFO_REQUIRED response/resubmit |
| Vendor application (API) | A role with required documents could be submitted with none | [`roles.service.ts`](../../apps/api/src/roles/roles.service.ts) rejects submission (400) when a role lists required documents and none are provided |
| Login redirect | `?next=` ignored — guests bounced to login always landed on `/dashboard` | [`login/page.tsx`](../../apps/web/app/login/page.tsx) honors a same-origin `?next=` (open-redirect-safe: must start `/`, not `//`) |
| Session persistence | 15-minute access token expired mid-demo on reload | `JWT_ACCESS_TTL` default → `2h` ([`env.ts`](../../apps/api/src/config/env.ts)). Safe: every request re-checks DB session existence, so revocation is still immediate |
| Storefront "View all" | Shop ignored `vendorSlug`, so per-store browsing was broken | [`products/page.tsx`](../../apps/web/app/products/page.tsx) honors `vendorSlug`, shows the store name + "Show all stores" |
| Landing nav | `#services`/`#providers`/… anchors dead on non-landing pages | [`Header.tsx`](../../apps/web/components/landing/Header.tsx) uses `/#…` |
| Landing card | Marketplace shown "coming soon" though Shop is live | [`data.ts`](../../apps/web/components/landing/data.ts): marketplace card → `live`, links to `/products` |
| Vendor products table | `overflow-hidden` clipped the table on mobile | [`dashboard/products/page.tsx`](../../apps/web/app/dashboard/products/page.tsx) → `overflow-x-auto` |
| Admin users filter | Dashboard "suspended accounts" card linked `?status=SUSPENDED`, ignored by the Users page | [`dashboard/users/page.tsx`](../../apps/admin/app/dashboard/users/page.tsx) reads `?status=`, passes it to the API, shows a clearable filter chip |

No security gap was found in guest/customer enforcement during the gap analysis —
the API was already default-deny. M12.1 hardens the *application document
requirement* and adds an explicit regression suite for the whole matrix.

---

## 4. What is intentionally NOT in scope

Delivery/shipping (Phase 4), passenger transport, jobs, real estate, marketing,
messaging, reviews, disputes; and any change to wallet/payment behaviour — payouts,
settlement, refunds, chargebacks. Money still moves only customer↔escrow (M12).

---

## 5. Verification

- **Automated:** `apps/api/test/demo-readiness.integration.spec.ts` (18 tests) plus
  the existing cart / orders / payments / vendor / workflows / wallet-authorization
  integration suites — all against real Postgres + MinIO.
- **Production E2E:** 26 numbered checks run against the deployed API with a
  dedicated verification account, self-cleaning, credentials never exposed. See
  [DEMO-CHECKLIST.md](./DEMO-CHECKLIST.md) §"Production verification".
