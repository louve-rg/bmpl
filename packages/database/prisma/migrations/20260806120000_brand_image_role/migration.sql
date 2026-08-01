-- Brand Image role (M6.2): an explicit, at-most-one-per-product listing image,
-- separate from gallery/variant images. Additive nullable-default boolean.
ALTER TABLE "product_images" ADD COLUMN "isBrandImage" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "product_images_productId_isBrandImage_idx" ON "product_images"("productId", "isBrandImage");
