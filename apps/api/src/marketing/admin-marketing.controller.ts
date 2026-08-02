import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  campaignStatusSchema,
  couponStatusSchema,
  createPlatformCouponSchema,
  promotionModerateSchema,
  resolvePromotionReportSchema,
  updateCouponSchema,
  type CampaignStatusInput,
  type CouponStatusInput,
  type CreatePlatformCouponInput,
  type PromotionModerateInput,
  type ResolvePromotionReportInput,
  type UpdateCouponInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PromotionsService } from './promotions.service';
import { CampaignsService } from './campaigns.service';
import { CouponsService } from './coupons.service';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingAdminService, type HomepageCurationInput } from './marketing-admin.service';

/** Admin Marketing moderation & operations (least privilege per route). */
@Controller('admin/marketing')
export class AdminMarketingController {
  constructor(
    private readonly promotions: PromotionsService,
    private readonly campaigns: CampaignsService,
    private readonly coupons: CouponsService,
    private readonly analytics: MarketingAnalyticsService,
    private readonly admin: MarketingAdminService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, permissions: u.permissions };
  }

  // ---- static routes first (before :id) ----
  @Get('promotions')
  @RequirePermission('promotions.read')
  listPromotions(@Query('status') status?: string, @Query('type') type?: string, @Query('reported') reported?: string) {
    return this.promotions.adminList({ status, type, reported: reported === 'true' });
  }

  @Get('reports')
  @RequirePermission('promotions.read')
  listReports(@Query('status') status?: string) {
    return this.admin.listReports(status);
  }

  @Post('reports/:id/resolve')
  @RequirePermission('promotions.moderate')
  resolveReport(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(resolvePromotionReportSchema)) b: ResolvePromotionReportInput) {
    return this.admin.resolveReport(this.actor(u), id, b);
  }

  @Get('campaigns')
  @RequirePermission('promotions.read')
  listCampaigns(@Query('status') status?: string, @Query('ownerUserId') ownerUserId?: string) {
    return this.campaigns.adminList({ status, ownerUserId });
  }

  @Post('campaigns/:id/status')
  @RequirePermission('campaigns.manage')
  campaignStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(campaignStatusSchema)) b: CampaignStatusInput) {
    return this.campaigns.adminSetStatus(this.actor(u), id, b);
  }

  @Get('coupons')
  @RequirePermission('coupons.manage')
  listCoupons(@Query('scope') scope?: string, @Query('status') status?: string, @Query('vendorProfileId') vendorProfileId?: string) {
    return this.coupons.adminList({ scope, status, vendorProfileId });
  }

  @Post('coupons')
  @RequirePermission('coupons.manage')
  createCoupon(@CurrentUser() u: AuthContext, @Body(ZodBody(createPlatformCouponSchema)) b: CreatePlatformCouponInput) {
    return this.coupons.adminCreatePlatform(this.actor(u), b);
  }

  @Patch('coupons/:id')
  @RequirePermission('coupons.manage')
  updateCoupon(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateCouponSchema)) b: UpdateCouponInput) {
    return this.coupons.adminUpdate(this.actor(u), id, b);
  }

  @Post('coupons/:id/status')
  @RequirePermission('coupons.manage')
  couponStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(couponStatusSchema)) b: CouponStatusInput) {
    return this.coupons.adminSetStatus(this.actor(u), id, b);
  }

  @Get('homepage')
  @RequirePermission('homepage.manage')
  getHomepage() {
    return this.admin.getHomepageCuration();
  }

  @Put('homepage')
  @RequirePermission('homepage.manage')
  setHomepage(@CurrentUser() u: AuthContext, @Body() b: HomepageCurationInput) {
    return this.admin.setHomepageCuration(this.actor(u), b);
  }

  @Get('analytics')
  @RequirePermission('marketing.analytics')
  analytics_() {
    return this.analytics.adminOverview();
  }

  // ---- promotion moderation (:id) ----
  @Get('promotions/:id')
  @RequirePermission('promotions.read')
  getPromotion(@Param('id') id: string) {
    return this.promotions.adminDetail(id);
  }

  @Post('promotions/:id/moderate')
  @RequirePermission('promotions.moderate')
  moderate(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(promotionModerateSchema)) b: PromotionModerateInput) {
    return this.promotions.moderate(this.actor(u), id, b);
  }

  @Post('promotions/:id/priority')
  @RequirePermission('promotions.manage')
  setPriority(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { priority?: number; isActive?: boolean }) {
    return this.promotions.setPriority(this.actor(u), id, b);
  }
}
