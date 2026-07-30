import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PaymentsService } from './payments.service';

/**
 * Customer payment reads (self-scoped). FOUNDATION ONLY — no capture, debit, or
 * settlement endpoints. Payments are created by checkout (see OrdersController).
 */
@Roles('CUSTOMER')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.payments.listOwn(user.userId);
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
