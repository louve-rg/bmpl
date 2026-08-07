import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { confirmPickupSchema, type ConfirmPickupInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { OrdersService } from './orders.service';
import { PickupService } from './pickup.service';
import { VendorFulfilmentService } from './vendor-fulfilment.service';

/** Vendor view of their own VendorOrders (owner-scoped; no cross-vendor access). */
@Roles('VENDOR')
@Controller('vendor/orders')
export class VendorOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly pickup: PickupService,
    private readonly fulfilment: VendorFulfilmentService,
  ) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, permissions: user.permissions, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.orders.listForVendor(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.orders.getForVendor(user.userId, id);
  }

  // ---- Fulfilment (M26.3) ----
  // Works for BOTH delivery methods. Marking a DELIVERY order ready is what
  // starts automatic dispatch, which is why a vendor previously had nothing to
  // do with a delivery order and it dead-ended.

  @Post(':id/start-preparing')
  startPreparing(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.fulfilment.startPreparing(user.userId, id);
  }

  @Post(':id/ready')
  markReady(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.fulfilment.markReady(user.userId, id);
  }

  // ---- Pickup fulfilment (M18.1) ----
  /** @deprecated Prefer `:id/ready`, which handles both pickup and delivery. */
  @Post(':id/ready-for-pickup')
  readyForPickup(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.pickup.markReadyForPickup(user.userId, id);
  }

  @StrictThrottle()
  @Post(':id/confirm-pickup')
  confirmPickup(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(confirmPickupSchema)) b: ConfirmPickupInput) {
    return this.pickup.confirmPickup(this.actor(user, req), id, b);
  }
}
