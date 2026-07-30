import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MaintenanceService } from './maintenance.service';

// Startup-only. Reuses OrdersService (reservation release) + the global
// PrismaService. No controllers/HTTP surface.
@Module({
  imports: [OrdersModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
