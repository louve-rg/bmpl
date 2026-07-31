import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../common/decorators';
import { WalletService } from './wallet.service';

/** Admin READ-ONLY wallet visibility: transactions + escrow/system balances.
 *  No manual adjustments. */
@RequirePermission('wallet.read')
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('transactions')
  transactions() {
    return this.wallet.adminList();
  }

  @Get('accounts')
  accounts() {
    return this.wallet.adminAccounts();
  }
}
