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

<!-- Sections 14–18 (tests, deployment, verification, cleanup, limitations)
     are appended after tests + deployment complete. -->
