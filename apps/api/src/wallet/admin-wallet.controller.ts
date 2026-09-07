import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { adminTestCreditSchema, adminWalletLockSchema, type AdminTestCreditInput, type AdminWalletLockInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { WalletService } from './wallet.service';

/**
 * Admin wallet visibility, plus the few operational actions that exist.
 *
 * Reads are read-only and always were. The test-credit write is not a manual
 * balance adjustment: it posts a labelled simulation credit through the
 * ordinary ledger. The lock/unlock pair is the fraud control over the
 * wallet's EXISTING status vocabulary and never touches an amount. There is
 * still no way for an administrator to set a balance. Releasing stale holds
 * lives on the admin payments controller, next to the rest of the payment
 * lifecycle.
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

  // ---- the fraud/security lock. Addressed by USER (the id an administrator
  // can see), reason required both ways, both directions audited.

  @Post('users/:userId/lock')
  @RequirePermission('wallet.lock')
  lock(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('userId') userId: string, @Body(ZodBody(adminWalletLockSchema)) dto: AdminWalletLockInput) {
    return this.wallet.setUserWalletLock({ userId: u.userId, ipAddress: req.ip, sessionId: u.sessionId }, userId, 'lock', dto.reason);
  }

  @Post('users/:userId/unlock')
  @RequirePermission('wallet.lock')
  unlock(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('userId') userId: string, @Body(ZodBody(adminWalletLockSchema)) dto: AdminWalletLockInput) {
    return this.wallet.setUserWalletLock({ userId: u.userId, ipAddress: req.ip, sessionId: u.sessionId }, userId, 'unlock', dto.reason);
  }
}
