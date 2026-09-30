import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  inventoryAdjustSchema,
  inventorySettingsSchema,
  type InventoryAdjustInput,
  type InventorySettingsInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { InventoryService } from './inventory.service';

/**
 * Vendor inventory manager. `?variantId=` targets a specific variant's stock;
 * omit it to target the product-level stock. Owner-scoped by vendor profile.
 */
@Roles('VENDOR')
@Controller('vendor/products/:productId/inventory')
export class ProductInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  get(@CurrentUser() user: AuthContext, @Param('productId') productId: string) {
    return this.inventory.getForProduct(user.userId, productId);
  }

  @Patch()
  settings(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Query('variantId') variantId: string | undefined,
    @Body(ZodBody(inventorySettingsSchema)) body: InventorySettingsInput,
  ) {
    return this.inventory.updateSettings(user.userId, productId, variantId ?? null, body);
  }

  @Post('adjust')
  adjust(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('variantId') variantId: string | undefined,
    @Body(ZodBody(inventoryAdjustSchema)) body: InventoryAdjustInput,
  ) {
    return this.inventory.adjust(this.actor(user, req), productId, variantId ?? null, body);
  }

  @Get('history')
  history(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Query('variantId') variantId: string | undefined,
  ) {
    return this.inventory.history(user.userId, productId, variantId ?? null);
  }

  // ---- Per-location stock (BMPL-175) ----

  /** One row per vendor location (present even if never stocked there). */
  @Get('locations')
  getLocations(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Query('variantId') variantId: string | undefined,
  ) {
    return this.inventory.getLocationsForProduct(user.userId, productId, variantId ?? null);
  }

  /** Adjust on-hand quantity at one location by a signed delta (same shape
   *  as POST .../adjust above) — the first adjustment at a location adopts
   *  per-location tracking for this product. */
  @Post('locations/:locationId/adjust')
  adjustLocation(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
    @Query('variantId') variantId: string | undefined,
    @Body(ZodBody(inventoryAdjustSchema)) body: InventoryAdjustInput,
  ) {
    return this.inventory.adjustAtLocation(this.actor(user, req), productId, variantId ?? null, locationId, body);
  }
}
