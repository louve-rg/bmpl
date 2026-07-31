import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { WalletService } from './wallet.service';

/** Customer wallet reads (self-scoped). A customer may view a wallet transaction
 *  they are party to. No money-moving endpoints here (authorization lives under
 *  /payments/:id/authorize). */
@Roles('CUSTOMER')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('transactions/:id')
  transaction(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.wallet.getForUser(user.userId, id);
  }
}
