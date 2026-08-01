import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { DriverModule } from '../driver/driver.module';
import { MessagingModule } from '../messaging/messaging.module';
import { DeliveryCoreService } from './delivery-core.service';
import { DispatchService } from './dispatch.service';
import { DriverJobService } from './driver-jobs.service';
import { DeliveryAccessService } from './delivery-access.service';
import { AdminDispatchController } from './admin-dispatch.controller';
import { DriverJobsController } from './driver-jobs.controller';
import { CustomerDeliveryController, VendorDeliveryStatusController } from './delivery-access.controller';

/**
 * Dispatch & Delivery Execution (M15). Connects eligible drivers to delivery
 * orders and runs the operational lifecycle (assign → accept → pickup → transit →
 * arriving → delivered, + decline / reassignment / pre-pickup cancellation).
 *
 * Reuses InventoryService + OwnershipService (ProductsModule) and driver
 * assignment-eligibility (DriverModule). Storage/Audit/Notifications are @Global().
 * NO GPS/tracking/routing/ETA/earnings/wallets/payouts/settlement.
 */
@Module({
  imports: [PrismaModule, ProductsModule, DriverModule, MessagingModule],
  controllers: [AdminDispatchController, DriverJobsController, CustomerDeliveryController, VendorDeliveryStatusController],
  providers: [DeliveryCoreService, DispatchService, DriverJobService, DeliveryAccessService],
})
export class DispatchModule {}
