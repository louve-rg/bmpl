-- Additive only: one nullable column, no backfill, no data touched.
-- Existing rows stay NULL and are served by the live fallback at read time.
ALTER TABLE "order_items" ADD COLUMN "imageStorageKey" TEXT;
