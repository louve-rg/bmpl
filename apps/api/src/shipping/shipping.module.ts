import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LogisticsNetworkService } from './logistics-network.service';
import { ShipmentService } from './shipment.service';
import { AdminLogisticsController, ShippingController, ShippingHubsController } from './shipping.controller';

/**
 * Multi-leg shipping.
 *
 * Sits BESIDE the delivery/dispatch modules, not over them. A local
 * single-courier delivery never touches this module: the planner refuses
 * same-town work outright so the caller uses the courier flow that already
 * works.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ShippingHubsController, ShippingController, AdminLogisticsController],
  providers: [LogisticsNetworkService, ShipmentService],
  exports: [ShipmentService, LogisticsNetworkService],
})
export class ShippingModule {}
