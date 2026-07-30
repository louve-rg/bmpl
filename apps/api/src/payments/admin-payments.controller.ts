import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../common/decorators';
import { PaymentsService } from './payments.service';

/** Admin READ-ONLY payment / wallet-hold / payment-event visibility. No actions. */
@RequirePermission('payments.read')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list() {
    return this.payments.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.payments.adminGet(id);
  }
}
