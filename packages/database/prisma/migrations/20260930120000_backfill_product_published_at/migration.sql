-- Backfill publishedAt for already-published products that never got one (legacy/
-- imported rows). Without this, ordering by publishedAt (NULLS LAST) buried these
-- products beneath newer ones regardless of recency — the "new products still at the
-- bottom in production" report. After this, every PUBLISHED product has a publishedAt,
-- and ordering by COALESCE(publishedAt, createdAt) is stable and correct.
UPDATE "products"
SET "publishedAt" = "createdAt"
WHERE "publishedAt" IS NULL AND "status" = 'PUBLISHED';
