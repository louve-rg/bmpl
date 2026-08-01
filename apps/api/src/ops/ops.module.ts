import { Module } from '@nestjs/common';
import { AdminOpsController, PublicOpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Platform Operations (M23). Cross-domain ops console (aggregated action queues +
 * audit export) and the announcement/maintenance banner. Prisma + AuditService are
 * @Global(). Read-only over domain tables; the only write is the platform-settings row.
 */
@Module({
  controllers: [AdminOpsController, PublicOpsController],
  providers: [OpsService],
  exports: [OpsService],
})
export class OpsModule {}
