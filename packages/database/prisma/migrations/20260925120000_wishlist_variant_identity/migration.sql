-- Wishlist exact-variant identity (M26.3 commerce). SavedProduct gains an optional
-- variantId so a wishlist entry can preserve the EXACT selected variant. Variant
-- entries are unique per (userId, variantId); product-level entries (variantId NULL)
-- are unique per (userId, productId) via a partial index. Existing rows are all
-- product-level (variantId NULL) and were previously unique on (userId, productId),
-- so the partial index builds cleanly with no data change.

-- Drop the old product-only uniqueness.
DROP INDEX "saved_products_userId_productId_key";

-- Add the variant reference.
ALTER TABLE "saved_products" ADD COLUMN "variantId" TEXT;

-- New indexes.
CREATE INDEX "saved_products_productId_idx" ON "saved_products"("productId");
CREATE UNIQUE INDEX "saved_products_userId_variantId_key" ON "saved_products"("userId", "variantId");

-- Product-level entries (no variant) remain unique per (user, product). Postgres
-- treats NULLs as distinct, so the composite unique above does not cover these.
CREATE UNIQUE INDEX "saved_products_user_product_default_key" ON "saved_products"("userId", "productId") WHERE "variantId" IS NULL;

-- FK to the variant (cascade so a hard-deleted variant removes its wishlist entries).
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
