import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { checkoutSchema, type CheckoutInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { OrdersService } from './orders.service';

/** Customer checkout + own order history (self-scoped by userId). */
@Roles('CUSTOMER')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Post('checkout')
  checkout(@CurrentUser() user: AuthContext, @Req() req: Request, @Body(ZodBody(checkoutSchema)) body: CheckoutInput) {
    return this.orders.checkout(this.actor(user, req), body);
  }

  @Get('orders')
  list(@CurrentUser() user: AuthContext) {
    return this.orders.listOwn(user.userId);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.orders.getOwn(user.userId, id);
  }
}
