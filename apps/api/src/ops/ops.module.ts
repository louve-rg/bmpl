import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { ShippingModule } from '../shipping/shipping.module';
import { AdminOpsController, PublicOpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Platform Operations (M23). Cross-domain ops console (aggregated action queues +
 * audit export) and the announcement/maintenance banner. Prisma + AuditService are
 * @Global(). Read-only over domain tables; the only write is the platform-settings row.
 *
 * Imports DispatchModule and ShippingModule (BMPL-293) so the overview can read
 * DispatchEngineService.waitingCount() / ShipmentDispatchService.waitingCount()
 * — the sweepers' own predicates — rather than the board writing a second
 * approximation of what they act on.
 */
@Module({
  imports: [DispatchModule, ShippingModule],
  controllers: [AdminOpsController, PublicOpsController],
  providers: [OpsService],
  exports: [OpsService],
})
export class OpsModule {}
