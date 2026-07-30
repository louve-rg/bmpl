import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';

// Prisma + Audit come from @Global() modules. PaymentsService is consumed by
// OrdersModule (checkout creates the payment graph; release cancels it).
@Module({
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
