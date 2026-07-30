import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  addCartItemSchema,
  updateCartItemSchema,
  type AddCartItemInput,
  type UpdateCartItemInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { CartService } from './cart.service';

/**
 * Authenticated customer's own shopping cart. Every route is scoped to the
 * caller's userId — a customer can only ever see or change their own cart, and
 * there is no admin/vendor surface onto customer carts. No admin approval or
 * moderation is involved anywhere in the cart flow.
 */
@Roles('CUSTOMER')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.cart.getActive(user.userId);
  }

  @Post('items')
  add(@CurrentUser() user: AuthContext, @Body(ZodBody(addCartItemSchema)) body: AddCartItemInput) {
    return this.cart.addItem(user.userId, body);
  }

  @Patch('items/:itemId')
  update(
    @CurrentUser() user: AuthContext,
    @Param('itemId') itemId: string,
    @Body(ZodBody(updateCartItemSchema)) body: UpdateCartItemInput,
  ) {
    return this.cart.updateItem(user.userId, itemId, body);
  }

  @Delete('items/:itemId')
  remove(@CurrentUser() user: AuthContext, @Param('itemId') itemId: string) {
    return this.cart.removeItem(user.userId, itemId);
  }

  @Delete()
  clear(@CurrentUser() user: AuthContext) {
    return this.cart.clear(user.userId);
  }
}
