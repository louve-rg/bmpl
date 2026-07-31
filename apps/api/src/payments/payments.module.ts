import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';

// Reuses InventoryService (release on authorization failure) from ProductsModule
// and WalletService (post/reverse escrow) from WalletModule. Prisma + Audit come
// from @Global() modules. Consumed by OrdersModule (checkout + release).
@Module({
  imports: [ProductsModule, WalletModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
