import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { expireHoldsSchema, type ExpireHoldsInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PaymentsService } from './payments.service';

/** Admin payment / wallet-hold / payment-event visibility, plus reconciliation. */
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('payments.read')
  list() {
    return this.payments.adminList();
  }

  @Get(':id')
  @RequirePermission('payments.read')
  get(@Param('id') id: string) {
    return this.payments.adminGet(id);
  }

  /**
   * Release soft holds whose payment never authorized.
   *
   * This can only ever give a reservation back to the person it was taken from;
   * there is no path through it that moves money anywhere. It runs on a schedule
   * as well — the endpoint is for when an operator needs it to happen now.
   */
  @Post('expire-stale-holds')
  @RequirePermission('wallet.reconcile')
  expireStale(@CurrentUser() u: AuthContext, @Body(ZodBody(expireHoldsSchema)) dto: ExpireHoldsInput) {
    return this.payments.expireStaleHolds({ userId: u.userId }, dto.olderThanHours);
  }
}
