# Phase 4 · M19 — Reviews & Ratings

**Verified** reviews and star ratings tied to **completed transactions**. A customer
may review a product, a vendor (store), or a driver only after the relevant order is
genuinely fulfilled — there is no way to rate something you didn't buy and receive.
Aggregates (average + count) are recomputed from source and cached on the subject;
vendors respond to reviews of their own products/store; users report abuse; admins
moderate.

**Out of scope (deferred):** unverified/anonymous reviews, review incentives, Q&A,
seller-initiated review requests, AI moderation/sentiment, cross-country i18n of review
text, review-based ranking/recommendations (M21), and any change to money, settlement,
inventory, publication, or delivery rules.

Related: [M18 settlement](../phase-3/M18-settlement-earnings.md) ·
[M18.1 pickup fulfilment](../phase-3/M18.1-pickup-fulfilment.md) ·
[M15 dispatch/delivery](./M15-dispatch-delivery-execution.md) ·
[ERD](../phase-2/DATABASE-SCHEMA.md) · [permission matrix](../phase-2/PERMISSION-MATRIX.md) ·
[route inventory](../phase-2/ROUTE-INVENTORY.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Verified-review model
A `Review` is uniquely identified per reviewer by **(reviewerId, subjectType, contextId)**.
The **context** is the concrete transaction row that proves eligibility; the **subject**
is what actually gets rated:

| subjectType | contextType | context row (the proof) | subjectId (the rated thing) |
|---|---|---|---|
| `PRODUCT` | `ORDER_ITEM` | the customer's `OrderItem` | `Product.id` |
| `VENDOR` | `VENDOR_ORDER` | the customer's `VendorOrder` | `VendorProfile.id` |
| `DRIVER` | `ORDER_DELIVERY` | the customer's `OrderDelivery` | `DriverProfile.id` |

`subjectId` is stored as a **plain indexed string** (no polymorphic FK) to avoid
relation-name churn across `Product`/`VendorProfile`/`DriverProfile`/`User`. Every
review is `verifiedPurchase = true` — there is no unverified path. The product review
also snapshots the exact purchased **variant** (`variantId`, `variantName`, `sku`,
`optionsSnapshot`) so "Perfect in Pink" stays attached to the review even if the
variant is later renamed or removed.

## 2. Eligibility (proven server-side)
Eligibility is derived from order records at review time — never trusted from the client:

- **PRODUCT** — the `OrderItem` belongs to an order owned by the reviewer, its
  `VendorOrder` is **fulfilled**, and the item still resolves to a product.
- **VENDOR** — the `VendorOrder` belongs to the reviewer's order and is **fulfilled**.
- **DRIVER** — the `OrderDelivery` belongs to the reviewer's order, is `DELIVERED`, has
  an assigned driver, and the reviewer is **not** that driver (no self-review).

**Fulfilled** = delivery `DELIVERED` (delivery orders) **or** pickup `PICKED_UP`
(pickup orders, per [M18.1](../phase-3/M18.1-pickup-fulfilment.md)). Consequently:
cancelled, rejected, unpaid, pending, in-transit, or **uncollected pickup** orders are
**not** review-eligible. A pickup order is never review-eligible merely because it was
placed — only after collection is confirmed. Ineligible attempts return `403`; a
context that isn't the caller's returns `404` (existence not leaked).

## 3. Duplicate prevention & editing
The unique `(reviewerId, subjectType, contextId)` constraint means one review per
verified context per subject type. A second attempt returns `400`. The author may
`PATCH` their own review (rating/title/body); editing the rating recomputes the
subject aggregate. `REJECTED` reviews cannot be edited.

## 4. Aggregation (source of truth)
`aggregateRatings(ratings)` (in `@bmpl/shared`) is a pure function returning
`{ average (2dp), count, distribution {1..5} }` over **PUBLISHED** reviews only. On
create / rating-edit / moderation the service **recomputes from source** and caches
`ratingAverage` + `ratingCount` onto the subject (`Product` / `VendorProfile` /
`DriverProfile`). Hidden/rejected reviews immediately drop out of the aggregate. The
public list endpoint returns the aggregate + distribution alongside the page so the
storefront/product page never has to trust the cached value.

## 5. Vendor responses
A vendor may add **one** response per review (editable) to reviews of **their own**
product or store — ownership is resolved via `OwnershipService.vendorProfileId` (a
foreign product/store returns `403`). The response is shown publicly beneath the
review; the author is notified when a seller first responds.

## 6. Reports & helpful votes
Any authenticated user may **report** a review (`SPAM`, `HARASSMENT`, `IRRELEVANT`,
`PROHIBITED`, `PRIVACY`, `FRAUDULENT`) — one open report per (review, reporter),
idempotent; admins with `reviews.read` are notified. Any authenticated user may toggle
a **helpful** vote (one per user; `helpfulCount` maintained transactionally).

## 7. Moderation
Admins list/filter reviews (`status`, `subjectType`, `reported`) and act:
`HIDE` (→ `HIDDEN`), `UNHIDE` (→ `PUBLISHED`), `REJECT` (→ `REJECTED`), each recording
`moderatedById` / `moderationReason` / `moderatedAt`, recomputing the aggregate, and
notifying the author. Reports are worked from a queue and resolved `ACTIONED` /
`DISMISSED` with an optional note. Moderation requires `reviews.moderate`; reading the
console requires `reviews.read`.

## 8. Media
Up to **5** photos per review, uploaded directly to **private** object storage under
the `reviews/<userId>` namespace via a presigned PUT (same pattern as message
attachments). Keys are asserted in-namespace and validated (JPEG/PNG/WebP, size cap)
on attach. Media is served to readers via short-lived signed download URLs; a rejected
media row is excluded from public output.

## 9. API surface
Public (no auth):
- `GET /marketplace/reviews/:subjectType/:subjectId?sort=&rating=&page=` — aggregate +
  distribution + paginated PUBLISHED reviews (pageSize 10; sort `helpful` /
  `rating_desc` / `rating_asc` / recent; optional rating filter).

Customer (`CUSTOMER`):
- `GET /reviews/eligible` — fulfilled contexts still awaiting a review.
- `GET /reviews/mine` — the caller's own reviews (any status).
- `POST /reviews/media/presign` *(StrictThrottle)* — presigned upload for a photo.
- `POST /reviews` *(StrictThrottle)* — create a verified review.
- `PATCH /reviews/:id` — edit own review.
- `POST /reviews/:id/report` — report a review.
- `POST /reviews/:id/helpful` — toggle a helpful vote.

Vendor (`VENDOR`):
- `POST /vendor/reviews/:id/response` — add/edit a response to an own-subject review.

Admin:
- `GET /admin/reviews` *(`reviews.read`)* — moderation list (filters).
- `GET /admin/reviews/reports` *(`reviews.read`)* — report queue.
- `POST /admin/reviews/:id/moderate` *(`reviews.moderate`)* — hide/unhide/reject.
- `POST /admin/reviews/reports/:id/resolve` *(`reviews.moderate`)* — resolve a report.

## 10. Data model
New models: `Review`, `ReviewMedia`, `ReviewResponse` (1:1 with a review),
`ReviewReport` (unique per review+reporter), `ReviewHelpfulVote` (unique per
review+user). New enums: `ReviewSubjectType`, `ReviewContextType`, `ReviewStatus`,
`ReviewReportReason`, `ReviewReportStatus`, `ReviewMediaStatus`. Cached aggregates
reuse the existing `ratingAverage` / `ratingCount` fields on `Product`,
`VendorProfile`, and `DriverProfile`. Migrations: `20260808120000_reviews_enums`
(enum-only, applied first) + `20260808121000_reviews` (tables). Seven new
`AuditAction`s (`REVIEW_CREATED`, `REVIEW_EDITED`, `REVIEW_MODERATED`,
`REVIEW_RESPONSE_ADDED`, `REVIEW_RESPONSE_EDITED`, `REVIEW_REPORTED`,
`REVIEW_REPORT_RESOLVED`) — mirrored in the Prisma enum and the `@bmpl/shared`
`AUDIT_ACTIONS` array.

## 11. Frontend
- **Product page** (`/products/[slug]`) — ratings summary + a "Ratings & reviews"
  section (aggregate, distribution bars, verified badge, purchased variant, media,
  seller response, helpful/report, sort/filter/pagination).
- **Storefront** (`/store/[slug]`) — store star rating + a customer-reviews section
  (`VENDOR` subject; the public storefront payload now exposes `vendorProfileId`).
- **Customer review center** (`/dashboard/reviews`) — "write a review" from eligible
  contexts + "my reviews" with inline edit.
- **Admin console** (`/dashboard/reviews`) — moderation list/filters + report queue
  with hide/unhide/reject and resolve actions (`reviews.read` / `reviews.moderate`).

## 12. Guarantees & invariants
- **No unverified reviews** — every review is proven against a fulfilled transaction
  the caller owns.
- **Pickup ≠ reviewable-on-placement** — pickup is reviewable only after `PICKED_UP`.
- **No money/inventory/publication side-effects** — reviews never touch orders,
  payments, wallet, settlement, inventory, or product/vendor publication state.
- **Aggregates always derived from PUBLISHED source** — moderation and edits keep the
  cached average/count honest.
- **Ownership-scoped** — vendor responses limited to own subjects; cross-tenant access
  returns `404`/`403`; suspended accounts cannot post.
- **Idempotent** — duplicate reviews (`400`), duplicate reports (silent ok), helpful
  votes (toggle) are all safe under retry.

## 13. Tests
`apps/api/test/reviews.integration.spec.ts` (8 groups) exercises verified product
review + exact variant snapshot + aggregate caching, vendor + driver reviews with
driver self-review blocked, pickup-only-after-`PICKED_UP` eligibility, rejection of
incomplete / cross-customer / duplicate / out-of-range submissions, suspended-user
denial, multi-review aggregate correctness + recompute-on-moderation, vendor-response
ownership, reports + admin visibility + helpful toggle, and the eligible-contexts feed.
`packages/shared/src/reviews.test.ts` unit-tests `aggregateRatings` / `isValidRating`.
Full suite: **310 API integration tests + shared/validation unit tests green**.
