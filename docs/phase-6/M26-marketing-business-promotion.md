# Phase 6 · M26 — Marketing & Business Promotion Foundation

Status: in progress. A promotion/campaign/coupon platform built entirely on existing
BMPL systems (auth, roles, approval, permissions, storage, notifications, audit,
analytics approach, moderation, ops). No subsystem is duplicated.

## 1. Architecture decisions
- **There is no `Business` entity.** A "business" is one of the existing per-user profile
  models: `VendorProfile` (store), `EmployerProfile` (jobs), `RealEstateAgentProfile` /
  `AgencyProfile` / `PropertyOwnerProfile` (real estate). All share
  `VendorApprovalStatus` and key on `userId` (agency: `managerUserId`). A promotion is
  therefore **owned by a user** (`Promotion.ownerUserId`) and **targets** existing entities.
- **Polymorphic targets, normalized (no JSON).** `PromotionTarget` carries a `targetType`
  enum plus typed nullable FKs (`vendorProfileId`, `employerProfileId`, `agencyProfileId`,
  `agentProfileId`, `propertyOwnerProfileId`, `productId`, `jobListingId`,
  `propertyListingId`, `externalUrl`). Exactly one FK is set per row.
- **Additive integration — zero marketplace regression (conservative, reversible).**
  Promotions are served through their OWN `marketing` endpoints and rendered as dedicated
  "Sponsored/Featured" sections on the homepage, category, search, discovery, marketplace,
  jobs, and real-estate surfaces. The existing organic marketplace/search/discovery
  ranking SQL is **NOT** modified. This satisfies "promotions influence discovery/search"
  while guaranteeing no regression to organic results; a deeper in-ranking boost is a
  reversible follow-up. *(Decision — see Questions log.)*
- **Suspension/expiry handled at serving time, not by cascade.** The public serving query
  validates each promotion's own status + window + `isActive` + campaign state, and each
  target's live status. A suspended/unpublished/deleted target (or an expired window)
  disappears automatically — no background job toggling rows.
- **Money is BZD minor units (BigInt)**, matching wallet/order conventions, WITHOUT any
  wallet or payment change. Coupons compute a `discountMinor` in the marketing domain only;
  wallet-checkout redemption is future work.

## 2. Promotion model (normalized, no JSON blobs)
`Campaign` (owner, type, status, timezone) → `CampaignSchedule` (windows) + `CampaignStatusHistory`.
`Promotion` (owner, campaign?, type, title/subtitle/description, status, priority, isActive,
start/end, timezone, moderation fields) → `PromotionPlacement` (placement enum + optional
`categoryId` context — never hardcoded), `PromotionAsset` (explicit `kind`: desktop/mobile/
square/hero/logo/video-placeholder, public storage key + altText + position), `PromotionTarget`
(polymorphic typed FKs), `PromotionMetricDaily` (per-day rollup: impressions/views/clicks/
conversions, unique per promotion+day+placement), `PromotionRedemption`, `PromotionReport`.
`Coupon` (code, scope PLATFORM|VENDOR, percentOff | amountOffMinor, freeShipping, minSpend,
maxDiscount, maxUses, perUserLimit, usedCount, stackable, status, window) → `CouponUsage`.

## 3. Campaign system
Lifecycle `DRAFT → SCHEDULED → RUNNING → PAUSED → EXPIRED → ARCHIVED` with a validated
transition map (`CAMPAIGN_TRANSITIONS` / `canTransitionCampaign`) and `CampaignStatusHistory`
audit rows. Schedules carry `startAt`/`endAt`/`timezone` (timezone-aware, default
`America/Belize`). A campaign only serves its promotions while `status === RUNNING` and
within a schedule window — automatic activation/expiration is evaluated at serve time.

## 4. Coupon system
Percentage or fixed-amount; `freeShipping` flag (future-compatible); min spend, max discount,
max uses, per-user limit, expiry/start/end, stackable flag; ACTIVE/INACTIVE/DISABLED. Scope
PLATFORM (admin-created) or VENDOR (vendor-owned, scoped to their store). `validate(code,
subtotalMinor, vendorProfileId?)` returns `{valid, discountMinor, reason?}` WITHOUT redeeming
or touching wallet. `CouponUsage` enforces `maxUses` and `perUserLimit`. Wallet-checkout
redemption is deferred (no order/wallet coupling).

## 5. Homepage & placements
`PromotionPlacementType`: homepage hero + featured businesses/products/jobs/properties,
category page, business page, marketplace, jobs, real estate, search, discovery. Placements
are an enum + optional `categoryId`, never hardcoded. Homepage placements require the
`homepage.manage` admin permission to curate. The web homepage adds a promoted section
(server component, `serverGetSafe`) beside the existing discovery sections.

## 6. Search / discovery integration (M21)
Additive: `GET /marketing/placements/{SEARCH|DISCOVERY|MARKETPLACE|...}` returns approved,
in-window promotions for the surface, which the frontend renders as a labelled
"Sponsored/Featured" band alongside — never reordering — organic results. Moderation is
never bypassed (only APPROVED promotions serve).

## 7. Business dashboard
Any business role (VENDOR / EMPLOYER / REAL_ESTATE_AGENT / PROPERTY_OWNER) manages ONLY its
own campaigns, promotions, media, schedules, coupons (vendor-scoped), analytics, and
promotion history + approval status. Ownership is verified per target.

## 8. Admin dashboard
`promotions.read/moderate/manage`, `campaigns.manage`, `coupons.manage`, `marketing.analytics`,
`homepage.manage`: moderation queue + approve/reject/request-info/pause/expire/archive,
featured/priority curation, platform coupons, campaign oversight, homepage placement
curation, abuse reports, and cross-promotion analytics.

## 9. Analytics
Per-promotion daily rollups (`PromotionMetricDaily`) aggregated the M22 way (groupBy/_sum,
no fabricated metrics). Tracks impressions, views, clicks, CTR (`computeCtr`), conversions,
coupon usage, and per-entity impressions (business/product/job/property). Owner analytics are
ownership-scoped; admin analytics are cross-promotion.

## 10. Security
Businesses manage only their own promotions/campaigns/coupons (owner-scoped; cross-owner →
404). Targets are ownership-verified. Coupons cannot be redeemed outside policy
(status/window/min-spend/limits/scope). Expired/paused/unpublished/suspended promotions and
targets disappear at serve time. Featured/homepage placement requires admin approval.
Unauthorized users cannot manage campaigns (role/permission guards). Analytics are scoped. No
wallet/payment/order/marketplace logic is changed.

## 11. Permissions (M26)
`promotions.read`, `promotions.moderate`, `promotions.manage`, `campaigns.manage`,
`coupons.manage`, `marketing.analytics`, `homepage.manage`. SUPPORT_AGENT gets
`promotions.read` + `marketing.analytics` (read-only). ADMIN gets all M26 permissions.
SUPER_ADMIN inherits everything.

## 12. Ops integration (M23)
The operations overview gains `pendingPromotionModeration` (promotions SUBMITTED/UNDER_REVIEW)
and `openPromotionReports` (OPEN abuse reports) queues.

## 13. API endpoint contract (authoritative surface)
All routes prefixed `/api`. Uploads use presign → direct PUT → confirm.

### Public — `@Public()` `marketing`
| Method | Path | Purpose |
|---|---|---|
| GET | `/marketing/homepage` | served hero + featured businesses/products/jobs/properties |
| GET | `/marketing/placements/:placement?categoryId=` | served promotions for one placement |
| GET | `/marketing/promotions/:id` | public promotion detail (only if serveable) |
| POST | `/marketing/promotions/:id/track` | best-effort impression/view/click/conversion (204) |
| POST | `/marketing/promotions/:id/report` | abuse report |
| POST | `/marketing/coupons/validate` | validate code vs subtotal (no redemption, no wallet) |

### Business — `@Roles('VENDOR','EMPLOYER','REAL_ESTATE_AGENT','PROPERTY_OWNER')` `business/marketing`
| Method | Path |
|---|---|
| GET / POST | `/campaigns` ; GET/PATCH `/campaigns/:id` ; POST `/campaigns/:id/schedules` ; DELETE `/campaigns/:id/schedules/:scheduleId` ; POST `/campaigns/:id/status` |
| GET / POST | `/promotions` ; GET/PATCH `/promotions/:id` |
| PUT | `/promotions/:id/placements` · `/promotions/:id/targets` (ownership-verified) |
| POST | `/promotions/:id/assets/presign` · `/promotions/:id/assets` ; DELETE `/promotions/:id/assets/:assetId` |
| POST | `/promotions/:id/submit` · `/promotions/:id/status` (PAUSE/RESUME/ARCHIVE) |
| GET | `/promotions/:id/analytics` |
| GET / POST | `/coupons` (vendor-scoped) ; GET/PATCH `/coupons/:id` ; POST `/coupons/:id/status` |
| GET | `/analytics` |

### Admin — `admin/marketing` (`@RequirePermission`)
| Method | Path | Permission |
|---|---|---|
| GET | `/admin/marketing/promotions` · `/:id` | `promotions.read` |
| POST | `/admin/marketing/promotions/:id/moderate` | `promotions.moderate` |
| POST | `/admin/marketing/promotions/:id/priority` | `promotions.manage` |
| GET | `/admin/marketing/reports` | `promotions.read` |
| POST | `/admin/marketing/reports/:id/resolve` | `promotions.moderate` |
| GET | `/admin/marketing/campaigns` | `promotions.read` |
| POST | `/admin/marketing/campaigns/:id/status` | `campaigns.manage` |
| GET / POST / PATCH | `/admin/marketing/coupons` · `/:id` | `coupons.manage` |
| POST | `/admin/marketing/coupons/:id/status` | `coupons.manage` |
| GET / PUT | `/admin/marketing/homepage` | `homepage.manage` |
| GET | `/admin/marketing/analytics` | `marketing.analytics` |

## 14. Tests
`apps/api/test/marketing.integration.spec.ts` (real Postgres + MinIO), 5 cases:
promotion lifecycle → moderation → public serving (drafts never serve); serving-time
suppression on pause/resume/**suspended target**/expire (asserting the promotion row is
untouched — no cascade writes); target **ownership** verification + cross-owner isolation
(A cannot target B's product; B cannot read/mutate A's promotion; a customer cannot use the
business surface); coupon validation policy (percentage + fixed, max-discount cap, min-spend,
vendor scope, unknown-code graceful, status/window); and metrics → analytics + abuse reports
→ admin resolve + admin permission gating. Full suite green: **350 integration + 30 unit +
24 shared + 22 validation**. All three apps build clean. `permission-sync` confirms the 7 new
permissions synced.

## 15. Deployment
Committed as one milestone `4316fd8` on `main`. Railway API redeployed
`--from-source`; both migrations applied via `preDeployCommand` (`prisma migrate deploy`);
promoted **2026-08-02**, live commit **`4316fd8`**. Web (`bmpl-web.vercel.app`) + admin
(`bmpl-admin.vercel.app`) auto-deployed from the push.

## 16. Production verification (live against `bmplapi-production`)
- `GET /api/health` → `{status:ok, commit:4316fd8}`; `GET /api/health/ready` → `200`
  `{database:true, redis:true, storage:ok}`.
- `GET /api/marketing/homepage` → `200` `{hero:[],featuredBusinesses:[],featuredProducts:[],
  featuredJobs:[],featuredProperties:[]}`; `GET /api/marketing/placements/HOMEPAGE_FEATURED_PRODUCTS`
  → `200`; `POST /api/marketing/coupons/validate` → `201` `{valid:false,reason:"Coupon not
  found."}` — all three query M26 tables, proving **migrations applied**.
- Gating: `business/marketing/*` and `admin/marketing/*` → `401` unauthenticated.
- **Web ↔ live API:** homepage renders the additive "Featured" band (SSR hit the live API,
  no fallback); `/products` `200` with organic grid intact; `/dashboard/business/marketing`
  and admin `/dashboard/marketing` exist (`307` → login).
- **No regression:** `marketplace/products|categories|discovery` `200`, `jobs` `200`,
  `properties` `200`, `orders`/`payments` gated `401`; zero `5xx`. Marketing is additive —
  organic ranking, wallet, payments, orders untouched.

## 17. Cleanup verification
No demo/test data created in production (never authenticated to the prod API during the
build; `marketing/homepage` empty confirms zero promotions). Local disposable MinIO (used for
integration tests because Docker isn't installed on this machine) was stopped; dev/test
databases are auto-reset by the integration suite.

## 18. Remaining limitations / recommended M27 scope
- **Coupon redemption at checkout** is intentionally NOT wired to orders/wallet (rule: no
  wallet/payment change). `validate` computes a discount; a `redeem` hook exists + is tested
  but is not attached to the order pipeline. Wiring it into checkout is M27 work.
- **In-ranking sponsored boost** is deferred: promotions render as additive labelled bands,
  never reordering organic marketplace/search results (conservative, zero-regression). A true
  ranking boost is a reversible follow-up.
- **Owner→target discovery**: the business promotion UI takes typed entity IDs for targets
  (ownership enforced server-side); a searchable owned-entity picker is a UX follow-up.
- **`PromotionMetricDaily` null-placement rows**: track events without a placement create one
  row per event (the compound unique treats NULL as distinct); SUM aggregation stays correct,
  but a sentinel placement would compact storage. Cosmetic; deferred.
- Deferred by scope (per the milestone brief): AI advertising/recommendations, external ad
  platforms (Google/Facebook), ad payment processing, marketing/email/SMS automation engines,
  mobile.

---

## Questions Requiring Owner Verification
Each ships behind a conservative, reversible default so the rest of the module is safe.

1. **Paid promotion / ad billing.** *Decision needed:* whether featured placement is a paid
   product and how it's billed. *Current conservative behavior:* promotions are **free** and
   admin-approved; there is NO ad payment processing (explicitly out of scope). *Recommended:*
   define pricing/billing before enabling paid placement.
2. **Sponsored-result ranking policy.** *Decision needed:* whether sponsored promotions may be
   interleaved into organic marketplace/search results (vs. the current separate labelled
   band). *Why it matters:* affects marketplace neutrality + regression risk. *Current:*
   additive labelled bands only; organic ranking untouched. *Recommended:* keep separate until
   a disclosure/ranking policy is set.
3. **Coupon → checkout redemption + funding.** *Decision needed:* who absorbs a coupon
   discount (vendor vs platform) and how it flows through wallet/settlement. *Current:*
   validation only, no wallet coupling. *Recommended:* decide funding before wiring redemption.
4. **Homepage curation authority.** *Decision needed:* which admin roles may curate the
   homepage hero/featured slots. *Current:* gated behind `homepage.manage` (ADMIN + SUPER_ADMIN).
   *Recommended:* keep restricted; revisit if a dedicated marketing role is introduced.

No question blocked schema/migration/authorization/privacy/financial integrity; the milestone
completed end-to-end including production deployment and verification.
