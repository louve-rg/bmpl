import { Body, Controller, Get, Post } from '@nestjs/common';
import { adminTestCreditSchema, type AdminTestCreditInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { WalletService } from './wallet.service';

/**
 * Admin wallet visibility, plus the two operational actions that exist.
 *
 * Reads are read-only and always were. The one write is not a manual balance
 * adjustment: it posts a labelled simulation credit through the ordinary
 * ledger. There is still no way for an administrator to set a balance.
 * Releasing stale holds lives on the admin payments controller, next to the
 * rest of the payment lifecycle.
 */
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('transactions')
  @RequirePermission('wallet.read')
  transactions() {
    return this.wallet.adminList();
  }

  @Get('accounts')
  @RequirePermission('wallet.read')
  accounts() {
    return this.wallet.adminAccounts();
  }

  /**
   * Post simulation credit to somebody's wallet.
   *
   * Every safeguard the self-service route has, this one keeps: the money moves
   * through a balanced TOPUP, the transaction is marked as test money whoever
   * receives it, and the audit row names the administrator and their reason.
   * The recipient's own account is not reclassified — a real customer stays a
   * real customer, and only the credit is simulated.
   */
  @Post('test-credit')
  @RequirePermission('wallet.credit_test')
  @StrictThrottle()
  testCredit(@CurrentUser() u: AuthContext, @Body(ZodBody(adminTestCreditSchema)) dto: AdminTestCreditInput) {
    return this.wallet.adminTestCredit(u.userId, dto.userId, BigInt(dto.amountMinor), dto.reason);
  }

}
