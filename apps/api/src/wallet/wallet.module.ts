import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { WalletService } from './wallet.service';

// Double-entry ledger persistence (M12). Prisma comes from the @Global() module.
// Exported so PaymentsService can post escrow transactions during authorization.
@Module({
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
