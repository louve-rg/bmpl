import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { PaymentsModule } from '../payments/payments.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersController } from './orders.controller';
import { VendorOrdersController } from './vendor-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';

// Reuses InventoryService (reservation), ProductImagesService (thumbnails), and
// OwnershipService (vendor scoping) from ProductsModule, and PaymentsService
// (payment/hold graph at checkout, cancel on release) from PaymentsModule.
// Prisma/Audit/Notifications come from @Global() modules.
@Module({
  imports: [ProductsModule, PaymentsModule, DeliveryModule],
  controllers: [OrdersController, VendorOrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
