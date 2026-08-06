-- Out-of-stock usability (M-usability).
-- 1) Vendors can auto-hide out-of-stock products/variants from the public marketplace.
-- 2) Customers can subscribe to a "notify me when back in stock" alert for an exact
--    product or variant (one-shot: removed after the restock notification fires).

-- Vendor visibility setting (default false = keep OOS visible with a badge + notify-me).
ALTER TABLE "vendor_settings" ADD COLUMN "hideOutOfStock" BOOLEAN NOT NULL DEFAULT false;

-- Back-in-stock subscriptions.
CREATE TABLE "back_in_stock_subscriptions" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "back_in_stock_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "back_in_stock_subscriptions_productId_variantId_idx" ON "back_in_stock_subscriptions"("productId", "variantId");
CREATE INDEX "back_in_stock_subscriptions_userId_idx" ON "back_in_stock_subscriptions"("userId");

-- Variant entries are unique per (user, variant).
CREATE UNIQUE INDEX "back_in_stock_subscriptions_userId_variantId_key" ON "back_in_stock_subscriptions"("userId", "variantId");
-- Product-level entries (no variant) unique per (user, product) — Postgres treats NULLs
-- as distinct, so the composite unique above does not cover these.
CREATE UNIQUE INDEX "back_in_stock_subscriptions_user_product_default_key" ON "back_in_stock_subscriptions"("userId", "productId") WHERE "variantId" IS NULL;

ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
