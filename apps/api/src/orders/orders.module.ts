import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OrdersController } from './orders.controller';
import { VendorOrdersController } from './vendor-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';

// Reuses InventoryService (reservation), ProductImagesService (thumbnails), and
// OwnershipService (vendor scoping) from ProductsModule. Prisma/Audit/
// Notifications come from @Global() modules. No parallel inventory/pricing/auth.
@Module({
  imports: [ProductsModule],
  controllers: [OrdersController, VendorOrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
