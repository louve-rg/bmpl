import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PaymentsService } from './payments.service';

/**
 * Customer payments (self-scoped). Reads are foundation-only; the single
 * money-moving action is wallet authorization (customer → escrow, M12). No
 * capture, settlement, refund, or payout endpoints.
 */
@Roles('CUSTOMER')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.payments.listOwn(user.userId);
  }

  /** Authorize a PENDING payment from the customer's wallet (customer → escrow). */
  @Post(':id/authorize')
  authorize(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.payments.authorize({ userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId }, id);
  }

  @Get('for-order/:orderId')
  forOrder(@CurrentUser() user: AuthContext, @Param('orderId') orderId: string) {
    return this.payments.forOrder(user.userId, orderId);
  }

  @Get(':id/status')
  status(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.payments.statusOwn(user.userId, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.payments.getOwn(user.userId, id);
  }
}
