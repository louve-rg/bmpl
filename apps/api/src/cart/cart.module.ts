import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

// Reuses InventoryService (availability derivation) and ProductImagesService
// (primary-image URLs) exported by ProductsModule — no parallel pricing or
// inventory logic. Prisma comes from the @Global() PrismaModule.
@Module({
  imports: [ProductsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
