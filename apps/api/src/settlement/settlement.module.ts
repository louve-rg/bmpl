import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProductsModule } from '../products/products.module';
import { SettlementService } from './settlement.service';
import { AdminSettlementController, CustomerSettlementController, DriverEarningsController, VendorSettlementController } from './settlement.controller';

/**
 * Settlement & Earnings (M18). Internal escrow distribution after fulfilment —
 * the ONE settlement path, posting balanced ledger transactions via WalletService
 * (the only sanctioned money-poster). Reuses OwnershipService (vendor scoping) from
 * ProductsModule; Audit/Notifications are @Global(). Exported so DispatchModule can
 * trigger settlement on delivery completion.
 */
@Module({
  imports: [PrismaModule, WalletModule, ProductsModule],
  controllers: [VendorSettlementController, DriverEarningsController, CustomerSettlementController, AdminSettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
