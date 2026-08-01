# Phase 4 · M21 — Discovery & Recommendations

Helps customers find products beyond an explicit search: a homepage **discovery**
surface, product-detail **cross-sell**, personalized **"for you"** recommendations,
and search **typeahead**. Everything is **deterministic and non-AI** — plain SQL
heuristics over the existing catalog, the M19 rating aggregates, and (for
personalization) the customer's own M20 saved/recently-viewed signals. Read-only:
**no schema change, no migration**, no money/inventory/moderation effects.

**Out of scope (deferred):** ML/AI ranking or embeddings, ad/sponsored placement,
collaborative filtering across users, price-drop/back-in-stock triggers, and
faceted-search aggregation (a possible later enhancement — the existing M7 filters
already cover category/price/stock/featured).

Related: [M7 catalog search](../phase-2/ROUTE-INVENTORY.md) (this builds on it, not
replaces it) · [M19 reviews](./M19-reviews-ratings.md) (rating signal) ·
[M20 saved/recently-viewed](./M20-saved-products-recently-viewed.md) (personalization
signal) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Relationship to existing search (M7)
M7 already provides full-text search (Postgres `tsvector` GIN + trigram), category
subtree / price / featured / in-stock filters, relevance/price sorting, pagination,
and vendor-directory search. M21 **does not** duplicate any of that — it adds the
discovery/recommendation/typeahead layer on top. All M21 results are resolved through
`ProductsService.cardsByIds`, so only PUBLISHED products of APPROVED vendors surface,
and each card carries the same shape as the catalog (including the M19
`ratingAverage`/`ratingCount`).

## 2. Discovery surface — `GET /marketplace/discovery` (public)
Returns an aggregated bundle for the homepage:

| Section | Heuristic |
|---|---|
| `featured` | `featured = true`, newest first |
| `topRated` | `ratingCount ≥ 1`, by `ratingAverage` then `ratingCount` |
| `newArrivals` | newest PUBLISHED products |
| `popular` | **real units sold** on AUTHORIZED/SETTLING/SETTLED orders, with a deterministic cold-start fallback (top-rated → featured → newest) so it is never empty on a fresh catalog |
| `categories` | top visible categories by PUBLISHED product count (`+ productCount`) |

## 3. Product-detail cross-sell — `GET /marketplace/products/:slug/related` (public)
`{ related, moreFromVendor }`. `related` = same-category products (rating-weighted),
back-filled from the same vendor to reach the target count; the product itself is
always excluded. `moreFromVendor` = other products from the same storefront. `404` for
an unknown or non-viewable slug.

## 4. Personalized "for you" — `GET /recommendations/for-you` (CUSTOMER)
Reads **only the caller's own** signals — the categories of products they recently
viewed (M20) or saved (M20) — and returns rating-ranked products in those categories,
**excluding** anything the caller already saved, viewed, or purchased. Cold-start or
thin results fall back to `popular()` (still excluding engaged items), so the response
is never empty. `{ personalized: boolean, items }` — `personalized:false` signals the
fallback so the UI can title it "Popular picks" instead of "Recommended for you".
There is no cross-user data: one customer's history never influences another's feed.
Guests get `401`.

## 5. Search typeahead — `GET /marketplace/search/suggest?q=` (public)
Grouped suggestions: `products` (title/brand match, rating-weighted), `categories`
(visible), `vendors` (approved). Each group is capped at `SUGGEST_SIZE` (5); queries
shorter than `SUGGEST_MIN_CHARS` (2) return empty groups. Case-insensitive `contains`
match (backed by the existing trigram indexes).

## 6. Frontend
- **Homepage** — discovery rows (Featured / Top rated / New arrivals / Popular) +
  "Shop by category" tiles, via a shared `ProductCard` + horizontal `ProductRow`.
- **Product detail** — "You may also like" + "More from {vendor}" rows below reviews.
- **Dashboard** — a "Recommended for you" / "Popular picks" row (hidden for guests).
- **Catalog** — a debounced search typeahead dropdown (products / categories /
  vendors); submitting the raw query runs the normal `/products?q=` search.

## 7. Guarantees & invariants
- **Read-only** — no schema/migration; discovery never mutates catalog, orders,
  inventory, money, or moderation state.
- **Public surfaces are safe** — only PUBLISHED/APPROVED products/vendors and visible
  categories ever appear.
- **Personalization is private** — "for you" uses only the caller's own M20 signals;
  no cross-user leakage.
- **Never empty** — popular and for-you have deterministic cold-start fallbacks, so
  discovery works on a brand-new catalog.

## 8. Tests
`apps/api/test/discovery.integration.spec.ts` (5 groups): homepage bundle shape +
PUBLISHED-only + featured/top-rated placement + non-empty popular fallback +
category counts; related same-category + more-from-vendor + self-exclusion + `404`;
for-you personalization from viewed/saved categories + engaged-item exclusion +
cold-start fallback + guest `401` + own-signal privacy; typeahead products/categories/
vendors + min-char guard. Full suite: **322 API integration tests green**.
