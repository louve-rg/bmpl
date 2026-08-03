import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { EngagementService } from './engagement.service';

/**
 * Saved products (wishlist) + recently-viewed history for the authenticated
 * customer. Every route is scoped to the caller's userId — there is no admin or
 * vendor surface onto this data, and recently-viewed history is private to its
 * owner. No money, inventory, or approval workflow is involved.
 */
@Roles('CUSTOMER')
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  // ---- Saved products (wishlist) ----
  @Get('saved')
  listSaved(@CurrentUser() u: AuthContext) {
    return this.engagement.listSaved(u.userId);
  }

  @Get('saved/ids')
  savedIds(@CurrentUser() u: AuthContext) {
    return this.engagement.savedIds(u.userId);
  }

  @Get('saved/count')
  savedCount(@CurrentUser() u: AuthContext) {
    return this.engagement.savedCount(u.userId);
  }

  // `variantId` (query) is the EXACT selected variant; omitted/empty for a
  // no-variant product. The service rejects a parent-level save when the product
  // has variants ("Choose your options…").
  @Post('saved/:productId')
  save(@CurrentUser() u: AuthContext, @Param('productId') productId: string, @Query('variantId') variantId?: string) {
    return this.engagement.save(u.userId, productId, variantId || null);
  }

  @Delete('saved/:productId')
  unsave(@CurrentUser() u: AuthContext, @Param('productId') productId: string, @Query('variantId') variantId?: string) {
    return this.engagement.unsave(u.userId, productId, variantId || null);
  }

  // ---- Recently viewed ----
  @Get('recently-viewed')
  listRecentlyViewed(@CurrentUser() u: AuthContext, @Query('limit') limit?: string) {
    return this.engagement.listRecentlyViewed(u.userId, limit ? Number(limit) : undefined);
  }

  @Post('recently-viewed/:productId')
  recordView(@CurrentUser() u: AuthContext, @Param('productId') productId: string) {
    return this.engagement.recordView(u.userId, productId);
  }

  @Delete('recently-viewed')
  clearRecentlyViewed(@CurrentUser() u: AuthContext) {
    return this.engagement.clearRecentlyViewed(u.userId);
  }
}
