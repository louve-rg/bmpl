import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsService } from './campaigns.service';
import { PromotionsService } from './promotions.service';
import { PromotionDiscoveryService } from './promotion-discovery.service';
import { CouponsService } from './coupons.service';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingAdminService } from './marketing-admin.service';
import { MarketingPublicController } from './marketing-public.controller';
import { BusinessMarketingController } from './business-marketing.controller';
import { AdminMarketingController } from './admin-marketing.controller';

/**
 * Marketing & Business Promotion (Phase 6 · M26). Owner-authored campaigns, promotions
 * (placements/targets/assets), and coupons — moderated before serving. Promotions render
 * as ADDITIVE placements via their OWN public endpoints and never mutate organic
 * marketplace/search ranking. Every business write is ownership-scoped and every promotion
 * target is verified to be owned by the actor. Storage/Audit/Notifications are @Global().
 */
@Module({
  imports: [PrismaModule],
  controllers: [MarketingPublicController, BusinessMarketingController, AdminMarketingController],
  providers: [
    CampaignsService,
    PromotionsService,
    PromotionDiscoveryService,
    CouponsService,
    MarketingAnalyticsService,
    MarketingAdminService,
  ],
  exports: [PromotionsService, CouponsService, PromotionDiscoveryService, MarketingAnalyticsService],
})
export class MarketingModule {}
