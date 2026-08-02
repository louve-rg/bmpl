import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  campaignScheduleSchema,
  campaignStatusSchema,
  couponStatusSchema,
  createCampaignSchema,
  createCouponSchema,
  createPromotionSchema,
  promotionAssetConfirmSchema,
  promotionAssetPresignSchema,
  promotionOwnerActionSchema,
  setPlacementsSchema,
  setTargetsSchema,
  updateCampaignSchema,
  updateCouponSchema,
  updatePromotionSchema,
  type CampaignScheduleInput,
  type CampaignStatusInput,
  type CouponStatusInput,
  type CreateCampaignInput,
  type CreateCouponInput,
  type CreatePromotionInput,
  type PromotionAssetConfirmInput,
  type PromotionAssetPresignInput,
  type PromotionOwnerActionInput,
  type SetPlacementsInput,
  type SetTargetsInput,
  type UpdateCampaignInput,
  type UpdateCouponInput,
  type UpdatePromotionInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { CampaignsService } from './campaigns.service';
import { PromotionsService } from './promotions.service';
import { CouponsService } from './coupons.service';
import { MarketingAnalyticsService } from './marketing-analytics.service';

/** Business marketing surface — a business authors campaigns, promotions (with placements,
 *  targets, and assets), and vendor coupons for the entities it OWNS. Every read/mutate is
 *  ownership-scoped; promotions require admin approval before serving. */
@Roles('VENDOR', 'EMPLOYER', 'REAL_ESTATE_AGENT', 'PROPERTY_OWNER')
@Controller('business/marketing')
export class BusinessMarketingController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly promotions: PromotionsService,
    private readonly coupons: CouponsService,
    private readonly analytics: MarketingAnalyticsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status, permissions: u.permissions };
  }

  // ---- campaigns ----
  @Get('campaigns')
  listCampaigns(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.campaigns.list(this.actor(u), status);
  }
  @Post('campaigns')
  createCampaign(@CurrentUser() u: AuthContext, @Body(ZodBody(createCampaignSchema)) b: CreateCampaignInput) {
    return this.campaigns.create(this.actor(u), b);
  }
  @Get('campaigns/:id')
  getCampaign(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.campaigns.detail(this.actor(u), id);
  }
  @Patch('campaigns/:id')
  updateCampaign(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateCampaignSchema)) b: UpdateCampaignInput) {
    return this.campaigns.update(this.actor(u), id, b);
  }
  @Post('campaigns/:id/schedules')
  addSchedule(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(campaignScheduleSchema)) b: CampaignScheduleInput) {
    return this.campaigns.addSchedule(this.actor(u), id, b);
  }
  @Delete('campaigns/:id/schedules/:scheduleId')
  removeSchedule(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('scheduleId') scheduleId: string) {
    return this.campaigns.removeSchedule(this.actor(u), id, scheduleId);
  }
  @Post('campaigns/:id/status')
  campaignStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(campaignStatusSchema)) b: CampaignStatusInput) {
    return this.campaigns.setStatus(this.actor(u), id, b);
  }

  // ---- promotions ----
  @Get('promotions')
  listPromotions(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.promotions.ownerList(this.actor(u), status);
  }
  @Post('promotions')
  createPromotion(@CurrentUser() u: AuthContext, @Body(ZodBody(createPromotionSchema)) b: CreatePromotionInput) {
    return this.promotions.create(this.actor(u), b);
  }
  @Get('promotions/:id')
  getPromotion(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.promotions.managedDetail(this.actor(u), id);
  }
  @Patch('promotions/:id')
  updatePromotion(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updatePromotionSchema)) b: UpdatePromotionInput) {
    return this.promotions.update(this.actor(u), id, b);
  }
  @Put('promotions/:id/placements')
  setPlacements(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(setPlacementsSchema)) b: SetPlacementsInput) {
    return this.promotions.setPlacements(this.actor(u), id, b);
  }
  @Put('promotions/:id/targets')
  setTargets(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(setTargetsSchema)) b: SetTargetsInput) {
    return this.promotions.setTargets(this.actor(u), id, b);
  }
  @StrictThrottle()
  @Post('promotions/:id/assets/presign')
  presignAsset(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(promotionAssetPresignSchema)) b: PromotionAssetPresignInput) {
    return this.promotions.presignAsset(this.actor(u), id, b.kind, b.fileName, b.contentType);
  }
  @Post('promotions/:id/assets')
  confirmAsset(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(promotionAssetConfirmSchema)) b: PromotionAssetConfirmInput) {
    return this.promotions.confirmAsset(this.actor(u), id, b);
  }
  @Delete('promotions/:id/assets/:assetId')
  deleteAsset(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('assetId') assetId: string) {
    return this.promotions.deleteAsset(this.actor(u), id, assetId);
  }
  @Post('promotions/:id/submit')
  submitPromotion(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.promotions.submit(this.actor(u), id);
  }
  @Post('promotions/:id/status')
  promotionStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(promotionOwnerActionSchema)) b: PromotionOwnerActionInput) {
    return this.promotions.ownerStatus(this.actor(u), id, b);
  }
  @Get('promotions/:id/analytics')
  promotionAnalytics(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.analytics.promotionOverview(u.userId, id);
  }

  // ---- coupons (vendor-scoped) ----
  @Get('coupons')
  listCoupons(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.coupons.vendorList(this.actor(u), status);
  }
  @Post('coupons')
  createCoupon(@CurrentUser() u: AuthContext, @Body(ZodBody(createCouponSchema)) b: CreateCouponInput) {
    return this.coupons.vendorCreate(this.actor(u), b);
  }
  @Get('coupons/:id')
  getCoupon(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.coupons.vendorDetail(this.actor(u), id);
  }
  @Patch('coupons/:id')
  updateCoupon(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateCouponSchema)) b: UpdateCouponInput) {
    return this.coupons.vendorUpdate(this.actor(u), id, b);
  }
  @Post('coupons/:id/status')
  couponStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(couponStatusSchema)) b: CouponStatusInput) {
    return this.coupons.vendorSetStatus(this.actor(u), id, b);
  }

  // ---- analytics ----
  @Get('analytics')
  analyticsOverview(@CurrentUser() u: AuthContext) {
    return this.analytics.ownerOverview(u.userId);
  }
}
