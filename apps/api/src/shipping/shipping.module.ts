import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DriverModule } from '../driver/driver.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentDriverService } from './shipment-driver.service';
import { DriverShippingController } from './driver-shipping.controller';
import { ShipmentDispatchScheduler } from './shipment-dispatch.scheduler';
import { LogisticsNetworkService } from './logistics-network.service';
import { ShipmentService } from './shipment.service';
import { AdminLogisticsController, ShippingController, ShippingHubsController, ShippingModesController } from './shipping.controller';

/**
 * Multi-leg shipping.
 *
 * Sits BESIDE the delivery/dispatch modules, not over them. A local
 * single-courier delivery never touches this module: the planner refuses
 * same-town work outright so the caller uses the courier flow that already
 * works.
 */
@Module({
  imports: [PrismaModule, DriverModule, DispatchModule, MessagingModule],
  controllers: [ShippingHubsController, ShippingModesController, ShippingController, AdminLogisticsController, DriverShippingController],
  providers: [LogisticsNetworkService, ShipmentService, ShipmentDispatchService, ShipmentDriverService, ShipmentDispatchScheduler],
  exports: [ShipmentService, LogisticsNetworkService, ShipmentDispatchService],
})
export class ShippingModule {}
