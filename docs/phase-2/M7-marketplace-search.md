# Phase 2 · M7 — Marketplace Browse / Search

Public marketplace browse with **PostgreSQL-only** full-text search, filtering,
sorting, and pagination. No external search engine.

## Database (migration `20260728150432_add_product_search`)
- `products.searchVector tsvector` — maintained by a **trigger**
  (`products_search_vector_trg`) with weights title=A, brand+keywords=B,
  description=C. (A generated column is rejected because `to_tsvector`-by-config
  is only STABLE; a trigger has no immutability requirement.) Backfilled existing
  rows.
- **GIN index** `products_search_idx` on the tsvector; **pg_trgm** extension +
  `products_title_trgm_idx` for fuzzy title matches. `searchVector` is declared
  `Unsupported("tsvector")` in the schema so Prisma tracks it without drift.

## Backend
- `ProductsService.publicList` rewritten as a single raw SQL query (uses the GIN
  index): full-text `websearch_to_tsquery` + ILIKE fallback, a **recursive
  category-subtree CTE** (parent shows descendants' products), price range,
  featured, and **in-stock** (inventory EXISTS) filters, `ts_rank` relevance sort
  (plus newest/price/featured), `count(*) OVER()` total, and LIMIT/OFFSET
  pagination. The page of ids is hydrated with Prisma (typed relations + primary
  image + in-stock flag).
- `VendorService.publicList` gains name search + district filter;
  `VendorPublicController` accepts `?q=&district=`.
- Query DTOs: `productQuerySchema` (+`priceMin`/`priceMax`/`inStock`),
  `vendorQuerySchema`.

## Frontend (`apps/web`)
- `/products`: search bar + price-range + in-stock filter form, category-tree
  sidebar, sort chips, pagination; out-of-stock badge on cards.
- `/vendors`: name search box.
- Category browsing (tree), product detail, and storefront integration reuse the
  existing M1–M6 surfaces.

## Tests
- **Integration** (`marketplace-search.integration.spec.ts`) — **9**: FTS on
  title/keywords/description, relevance ranking, category-subtree filter, price
  range, featured, in-stock exclusion, price sort, pagination + total, vendor
  name search.
- **Unit**: query-filter coercion (+1). **Full API integration suite: 122 passed
  (12 files).** shared 12, validation 21. api/web/admin build + typecheck clean.

## Migration & deployment
Trigger + GIN indexes + pg_trgm applied local + `bmpl_test`; applied to Railway on
deploy. PostgreSQL-only — no external services.
