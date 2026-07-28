import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { AdminProductsController } from './admin-products.controller';
import { ProductsPublicController } from './products-public.controller';
import { ProductImagesController } from './product-images.controller';
import { ProductsService } from './products.service';
import { ProductImagesService } from './product-images.service';

// Prisma/Audit/Notifications/Storage come from @Global() modules.
@Module({
  controllers: [
    ProductsController,
    AdminProductsController,
    ProductsPublicController,
    ProductImagesController,
  ],
  providers: [ProductsService, ProductImagesService],
  exports: [ProductsService, ProductImagesService],
})
export class ProductsModule {}
