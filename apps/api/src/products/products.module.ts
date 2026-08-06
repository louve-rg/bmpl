import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { AdminProductsController } from './admin-products.controller';
import { ProductsPublicController } from './products-public.controller';
import { ProductImagesController } from './product-images.controller';
import { ProductVariantsController } from './product-variants.controller';
import { ProductInventoryController } from './product-inventory.controller';
import { ProductsService } from './products.service';
import { ProductImagesService } from './product-images.service';
import { VariantsService } from './variants.service';
import { InventoryService } from './inventory.service';
import { OwnershipService } from './ownership.service';
import { BackInStockService } from './back-in-stock.service';
import { BackInStockController } from './back-in-stock.controller';

// Prisma/Audit/Notifications/Storage come from @Global() modules.
@Module({
  controllers: [
    ProductsController,
    AdminProductsController,
    ProductsPublicController,
    ProductImagesController,
    ProductVariantsController,
    ProductInventoryController,
    BackInStockController,
  ],
  providers: [ProductsService, ProductImagesService, VariantsService, InventoryService, OwnershipService, BackInStockService],
  exports: [ProductsService, ProductImagesService, VariantsService, InventoryService, OwnershipService, BackInStockService],
})
export class ProductsModule {}
