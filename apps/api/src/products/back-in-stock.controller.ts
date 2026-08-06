import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { BackInStockService } from './back-in-stock.service';

/**
 * "Notify me when back in stock" — customer-scoped subscriptions for an exact product
 * or variant. `variantId` (query) is the EXACT variant; omit for a no-variant product.
 */
@Roles('CUSTOMER')
@Controller('back-in-stock')
export class BackInStockController {
  constructor(private readonly backInStock: BackInStockService) {}

  @Get('ids')
  ids(@CurrentUser() u: AuthContext) {
    return this.backInStock.subscribedIds(u.userId);
  }

  @Post(':productId')
  subscribe(@CurrentUser() u: AuthContext, @Param('productId') productId: string, @Query('variantId') variantId?: string) {
    return this.backInStock.subscribe(u.userId, productId, variantId || null);
  }

  @Delete(':productId')
  unsubscribe(@CurrentUser() u: AuthContext, @Param('productId') productId: string, @Query('variantId') variantId?: string) {
    return this.backInStock.unsubscribe(u.userId, productId, variantId || null);
  }
}
