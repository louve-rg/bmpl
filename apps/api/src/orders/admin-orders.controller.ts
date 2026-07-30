import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../common/decorators';
import { OrdersService } from './orders.service';

/** Admin READ-ONLY order visibility. No editing / fulfilment controls in M10. */
@RequirePermission('orders.read')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list() {
    return this.orders.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.adminGet(id);
  }
}
