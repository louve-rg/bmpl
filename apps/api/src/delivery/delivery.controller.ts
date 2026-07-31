import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  deliveryEstimateSchema,
  deliveryQuoteSchema,
  deliveryZoneSchema,
  deliveryZoneUpdateSchema,
  type DeliveryEstimateInput,
  type DeliveryQuoteInput,
  type DeliveryZoneInput,
  type DeliveryZoneUpdateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { CustomerDeliveryService, VendorDeliveryService } from './delivery.service';

/** Vendor-owner delivery configuration (settings live under PATCH /vendor/settings). */
@Roles('VENDOR')
@Controller('vendor/delivery')
export class VendorDeliveryController {
  constructor(private readonly delivery: VendorDeliveryService) {}

  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.delivery.getOwn(user.userId);
  }

  @Post('zones')
  createZone(@CurrentUser() user: AuthContext, @Body(ZodBody(deliveryZoneSchema)) body: DeliveryZoneInput) {
    return this.delivery.createZone(user.userId, body);
  }

  @Patch('zones/:id')
  updateZone(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(deliveryZoneUpdateSchema)) body: DeliveryZoneUpdateInput,
  ) {
    return this.delivery.updateZone(user.userId, id, body);
  }

  @Delete('zones/:id')
  deleteZone(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.delivery.deleteZone(user.userId, id);
  }

  @Put('estimate')
  upsertEstimate(@CurrentUser() user: AuthContext, @Body(ZodBody(deliveryEstimateSchema)) body: DeliveryEstimateInput) {
    return this.delivery.upsertEstimate(user.userId, body);
  }
}

/** Customer pre-checkout delivery quote for the active cart. */
@Roles('CUSTOMER')
@Controller('checkout')
export class CustomerDeliveryController {
  constructor(private readonly delivery: CustomerDeliveryService) {}

  @Post('delivery-quote')
  quote(@CurrentUser() user: AuthContext, @Body(ZodBody(deliveryQuoteSchema)) body: DeliveryQuoteInput) {
    return this.delivery.quote(user.userId, body);
  }
}
