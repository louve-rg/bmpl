-- AlterTable: associate a product image with a specific variant (nullable = general product image)
ALTER TABLE "product_images" ADD COLUMN     "variantId" TEXT;

-- CreateIndex
CREATE INDEX "product_images_variantId_idx" ON "product_images"("variantId");

-- AddForeignKey: deleting a variant keeps its images as general product images (SET NULL)
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
