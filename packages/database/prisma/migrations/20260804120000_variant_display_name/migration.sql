-- Variant Display Name (M6.1 — Vendor variant/image workflow redesign).
-- A first-class, variant-specific marketplace title, independent of the base
-- product title and option-value labels. Nullable; when unset the API falls back
-- to the option-value label join, which preserves every existing variant's name
-- exactly (no destructive backfill needed).
ALTER TABLE "product_variants" ADD COLUMN "displayName" TEXT;
