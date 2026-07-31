import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DriverService } from './driver.service';
import { AdminDriverService } from './admin-driver.service';
import { DriverController } from './driver.controller';
import { AdminDriverController } from './admin-driver.controller';

/**
 * Driver Management Foundation (M14). Driver-owner profile/vehicles/service-areas/
 * availability + admin driver views/vehicle-moderation. Storage/Audit/Notifications
 * come from @Global() modules. Driver-ROLE approval reuses the role-application system.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DriverController, AdminDriverController],
  providers: [DriverService, AdminDriverService],
})
export class DriverModule {}
