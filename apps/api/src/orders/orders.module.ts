import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { PaymentsModule } from '../payments/payments.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersController } from './orders.controller';
import { VendorOrdersController } from './vendor-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';
import { PickupService } from './pickup.service';

// Reuses InventoryService (reservation + M18.1 pickup finalization), ProductImagesService
// (thumbnails), and OwnershipService (vendor scoping) from ProductsModule, and
// PaymentsService from PaymentsModule. Prisma/Audit/Notifications come from @Global().
@Module({
  imports: [ProductsModule, PaymentsModule, DeliveryModule],
  controllers: [OrdersController, VendorOrdersController, AdminOrdersController],
  providers: [OrdersService, PickupService],
  exports: [OrdersService, PickupService],
})
export class OrdersModule {}
