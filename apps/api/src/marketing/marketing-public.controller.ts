import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  promotionReportSchema,
  trackPromotionEventSchema,
  validateCouponSchema,
  type PromotionReportInput,
  type TrackPromotionEventInput,
  type ValidateCouponInput,
} from '@bmpl/validation';
import type { PromotionPlacementType } from '@bmpl/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import { PromotionDiscoveryService } from './promotion-discovery.service';
import { CouponsService } from './coupons.service';

/** Public marketing surface — homepage bundle, per-placement serving, promotion detail,
 *  best-effort metric tracking, abuse reporting, and coupon validation (guests included). */
@Public()
@Controller('marketing')
export class MarketingPublicController {
  constructor(
    private readonly discovery: PromotionDiscoveryService,
    private readonly coupons: CouponsService,
  ) {}

  @Get('homepage')
  homepage() {
    return this.discovery.homepage();
  }

  @Get('placements/:placement')
  placement(@Param('placement') placement: string, @Query('categoryId') categoryId?: string, @Query('device') device?: string) {
    const dev = device === 'DESKTOP' || device === 'MOBILE' ? device : undefined;
    return this.discovery.servePlacement(placement as PromotionPlacementType, categoryId, { device: dev });
  }

  @Get('promotions/:id')
  promotion(@Param('id') id: string) {
    return this.discovery.publicDetail(id);
  }

  @Post('promotions/:id/track')
  @HttpCode(204)
  async track(@Param('id') id: string, @Body(ZodBody(trackPromotionEventSchema)) b: TrackPromotionEventInput) {
    await this.discovery.track(id, b);
  }

  @StrictThrottle()
  @Post('promotions/:id/report')
  report(@Param('id') id: string, @Body(ZodBody(promotionReportSchema)) b: PromotionReportInput) {
    return this.discovery.report(null, id, b);
  }

  @Post('coupons/validate')
  validateCoupon(@Body(ZodBody(validateCouponSchema)) b: ValidateCouponInput) {
    return this.coupons.validate(b);
  }
}
