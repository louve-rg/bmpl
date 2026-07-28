-- Marketplace index tuning (M8).

-- Replace the plain status index with a composite (status, createdAt) that also
-- serves the default "newest published" catalog sort.
DROP INDEX IF EXISTS "products_status_idx";
CREATE INDEX "products_status_createdAt_idx" ON "products"("status", "createdAt");

-- Serves the batched primary-image lookup on every catalog/listing page.
CREATE INDEX "product_images_productId_isPrimary_idx" ON "product_images"("productId", "isPrimary");

-- IMPORTANT: preserve the full-text search indexes. They are created and managed
-- manually (Prisma cannot track GIN indexes on the Unsupported `searchVector`
-- tsvector column, so its auto-diff tries to DROP them). Recreate defensively —
-- a no-op where they already exist (fresh DBs from the M7 migration), and a
-- restore where a prior auto-generated diff removed them.
CREATE INDEX IF NOT EXISTS "products_search_idx" ON "products" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);
