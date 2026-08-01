# Phase 4 · M20 — Saved Products (Wishlists) & Recently Viewed

Customer convenience: a **wishlist** of saved products and a private **recently-viewed**
history. Both are own-account-only reads/writes — they never reserve stock, move
money, touch inventory or orders, and are never exposed to any other user (vendors and
admins included).

**Out of scope (deferred):** price-drop / back-in-stock alerts, shared/public
wishlists, guest (cookie) wishlists, wishlist-based recommendations (M21), and any
admin analytics over saved/viewed data (M22).

Related: [M19 reviews](./M19-reviews-ratings.md) (cards carry the rating aggregate) ·
[ERD](../phase-2/DATABASE-SCHEMA.md) · [permission matrix](../phase-2/PERMISSION-MATRIX.md) ·
[route inventory](../phase-2/ROUTE-INVENTORY.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Model
Two thin join tables, both scoped to the owning user:

| Model (table) | Key | Notes |
|---|---|---|
| `SavedProduct` (saved_products) | unique `(userId, productId)` | product-level wishlist entry; the variant is chosen later at add-to-cart time |
| `RecentlyViewedProduct` (recently_viewed_products) | unique `(userId, productId)` | one row per product; `viewedAt` upserted on each view; capped to newest N |

Both `onDelete: Cascade` from `User` **and** `Product`, so deleting either side cleans
up automatically. No money, inventory, or approval columns exist on either table.

## 2. Viewability & card resolution
Saving or recording a view first asserts the product is **publicly viewable**
(`PUBLISHED` + `APPROVED` vendor) via `ProductsService.assertViewable` — a draft,
suspended, archived, or unapproved-vendor product returns `404`. Listings resolve
cards through the shared `ProductsService.cardsByIds` (the same card shape as the
catalog, including the M19 `ratingAverage`/`ratingCount`), which returns **only**
currently-viewable products. A saved/viewed product that later becomes non-viewable is
returned as `{ available: false, product: null }` — the row is **kept**, so if the
product is re-published it reappears automatically. This keeps public surfaces honest
(no leaking unpublished products) without silently losing a customer's wishlist entry.

## 3. Recently-viewed cap
`recordView` upserts `viewedAt = now()` (so re-viewing moves a product to the front
without duplicating it) and then prunes to the newest `RECENTLY_VIEWED_MAX` (50) rows
per user. The list endpoint returns most-recent-first, `limit` clamped to the cap.
Customers can `DELETE /recently-viewed` to clear the entire history (privacy control).

## 4. API surface (all `@Roles('CUSTOMER')`; guests → 401)
Saved products (wishlist):
- `GET /saved` — the caller's saved products, newest first, with resolved cards.
- `GET /saved/ids` — lightweight `{ productIds }` for heart-toggle state on listings.
- `GET /saved/count` — badge count.
- `POST /saved/:productId` — save (idempotent; `404` if not viewable).
- `DELETE /saved/:productId` — remove (idempotent).

Recently viewed:
- `GET /recently-viewed?limit=` — newest-first history (limit clamped to 50).
- `POST /recently-viewed/:productId` — record a view (`404` if not viewable).
- `DELETE /recently-viewed` — clear the caller's history.

There is deliberately **no** admin or vendor endpoint onto this data.

## 5. Frontend
- **Save button** — a heart toggle island on catalog cards, storefront featured
  cards, and the product detail buy area. Optimistic; a guest click routes to
  `/login?next=…`. Heart state hydrates from a single deduped `/saved/ids` fetch and
  stays in sync across the page via a `SAVED_CHANGED` event (mirrors the cart pattern).
- **Header** — a saved-items icon with a live count badge next to the cart icon.
- **`/wishlist`** — the saved grid (image, title, price, rating, vendor, stock badge,
  remove, link to product) with a "Recently viewed" strip below it and a "Clear"
  control. Unavailable items render greyed with remove-only.
- **Recently-viewed recording** — the product detail page fires a fire-and-forget
  `POST /recently-viewed/:id` on view (guests are simply not recorded).

## 6. Guarantees & invariants
- **Own-account only** — every route is userId-scoped; recently-viewed history is
  private and never surfaced to vendors/admins.
- **No money/inventory/order side-effects** — saving or viewing changes nothing about
  stock, reservations, carts, or payments.
- **No leaking unpublished products** — cards resolve only PUBLISHED/APPROVED products;
  others surface as `available:false`.
- **Idempotent** — repeat save, repeat unsave, and re-view are all safe under retry.

## 7. Tests
`apps/api/test/engagement.integration.spec.ts` (7 tests): idempotent save + card +
ids/count + unsave; `404` for non-viewable save + no inventory movement;
available:false-after-unpublish (row preserved, reappears on re-publish); wishlist
cross-user isolation + guest 401; recently-viewed ordering + re-view reordering +
clear; newest-`RECENTLY_VIEWED_MAX` cap + non-viewable `404`; recently-viewed privacy
+ guest 401. Full suite: **317 API integration tests green**.
