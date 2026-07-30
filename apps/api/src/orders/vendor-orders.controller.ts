import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { OrdersService } from './orders.service';

/** Vendor view of their own VendorOrders (owner-scoped; no cross-vendor access). */
@Roles('VENDOR')
@Controller('vendor/orders')
export class VendorOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.orders.listForVendor(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.orders.getForVendor(user.userId, id);
  }
}
