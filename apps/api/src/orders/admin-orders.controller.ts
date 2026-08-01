import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { pickupOverrideSchema, type PickupOverrideInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { OrdersService } from './orders.service';
import { PickupService } from './pickup.service';

/**
 * Admin order visibility. Reads are READ-ONLY (`orders.read`). The single
 * operational action — releasing an order's inventory reservations (M10.1) —
 * requires the stronger `orders.manage` and is idempotent. No customer
 * cancellation, editing, or fulfilment controls.
 */
@RequirePermission('orders.read')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService, private readonly pickup: PickupService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, permissions: user.permissions, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  list() {
    return this.orders.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.adminGet(id);
  }

  /** Release the inventory reserved for an order (operational; idempotent). */
  @RequirePermission('orders.manage')
  @Post(':id/release-reservations')
  release(@CurrentUser() user: AuthContext, @Req() _req: Request, @Param('id') id: string) {
    return this.orders.releaseReservations(id, user.userId);
  }

  /** Admin override to confirm a pickup collection (reason required; M18.1). */
  @RequirePermission('orders.manage')
  @Post('vendor-orders/:vendorOrderId/confirm-pickup')
  confirmPickup(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('vendorOrderId') vendorOrderId: string, @Body(ZodBody(pickupOverrideSchema)) b: PickupOverrideInput) {
    return this.pickup.adminConfirmPickup(this.actor(user, req), vendorOrderId, b);
  }
}
