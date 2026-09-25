import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { cancelOrderSchema, checkoutSchema, type CancelOrderInput, type CheckoutInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { OrdersService } from './orders.service';
import { PickupService } from './pickup.service';

/** Customer checkout + own order history (self-scoped by userId). */
@Roles('CUSTOMER')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly pickup: PickupService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Post('checkout')
  checkout(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(checkoutSchema)) body: CheckoutInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.checkout(this.actor(user, req), body, idempotencyKey?.trim() || undefined);
  }

  @Get('orders')
  list(@CurrentUser() user: AuthContext) {
    return this.orders.listOwn(user.userId);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.orders.getOwn(user.userId, id);
  }

  /**
   * Cancel my own order — the whole order, only while every vendor-order is
   * still PENDING. Money moves only through the existing release path; the
   * window and the race are enforced in the service.
   */
  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body(ZodBody(cancelOrderSchema)) dto: CancelOrderInput) {
    return this.orders.cancelOwn({ userId: user.userId }, id, dto);
  }

  /** Reveal the customer's own pickup PIN to show the store (M18.1). */
  @Get('orders/vendor-orders/:vendorOrderId/pickup-pin')
  pickupPin(@CurrentUser() user: AuthContext, @Param('vendorOrderId') vendorOrderId: string) {
    return this.pickup.customerPickupPin(user.userId, vendorOrderId);
  }
}
