import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { AdminProductsController } from './admin-products.controller';
import { ProductsPublicController } from './products-public.controller';
import { ProductsService } from './products.service';

// Prisma/Audit/Notifications come from @Global() modules.
@Module({
  controllers: [ProductsController, AdminProductsController, ProductsPublicController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
