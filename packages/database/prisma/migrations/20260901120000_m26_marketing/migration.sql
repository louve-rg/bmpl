-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('SEASONAL', 'LIMITED_TIME', 'SALE', 'COUPON', 'DISCOUNT', 'FEATURED', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('FEATURED_BUSINESS', 'FEATURED_STORE', 'FEATURED_PRODUCT', 'FEATURED_PROPERTY', 'FEATURED_JOB', 'HOMEPAGE_BANNER', 'CATEGORY_BANNER', 'ANNOUNCEMENT_BANNER', 'LIMITED_TIME', 'COUPON_CAMPAIGN', 'DISCOUNT_CAMPAIGN', 'SEASONAL_CAMPAIGN', 'HOMEPAGE_HERO');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'PAUSED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionTargetType" AS ENUM ('VENDOR', 'EMPLOYER', 'AGENCY', 'AGENT', 'PROPERTY_OWNER', 'PRODUCT', 'JOB', 'PROPERTY', 'EXTERNAL_LINK', 'NONE');

-- CreateEnum
CREATE TYPE "PromotionPlacementType" AS ENUM ('HOMEPAGE_HERO', 'HOMEPAGE_FEATURED_BUSINESSES', 'HOMEPAGE_FEATURED_PRODUCTS', 'HOMEPAGE_FEATURED_JOBS', 'HOMEPAGE_FEATURED_PROPERTIES', 'CATEGORY_PAGE', 'BUSINESS_PAGE', 'MARKETPLACE', 'JOBS', 'REAL_ESTATE', 'SEARCH', 'DISCOVERY');

-- CreateEnum
CREATE TYPE "PromotionAssetKind" AS ENUM ('DESKTOP_BANNER', 'MOBILE_BANNER', 'SQUARE_IMAGE', 'HERO_IMAGE', 'LOGO', 'VIDEO_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "PromotionReportReason" AS ENUM ('MISLEADING', 'INAPPROPRIATE', 'SCAM', 'PROHIBITED', 'IRRELEVANT', 'OTHER');

-- CreateEnum
CREATE TYPE "PromotionReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('PLATFORM', 'VENDOR');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISABLED');


-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CampaignType" NOT NULL DEFAULT 'FEATURED',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'America/Belize',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_schedules" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Belize',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_status_history" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fromStatus" "CampaignStatus",
    "toStatus" "CampaignStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "campaignId" TEXT,
    "type" "PromotionType" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Belize',
    "moderationReason" TEXT,
    "moderatedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_placements" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "placement" "PromotionPlacementType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_assets" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "kind" "PromotionAssetKind" NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "videoUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_targets" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "targetType" "PromotionTargetType" NOT NULL,
    "vendorProfileId" TEXT,
    "employerProfileId" TEXT,
    "agencyProfileId" TEXT,
    "agentProfileId" TEXT,
    "propertyOwnerProfileId" TEXT,
    "productId" TEXT,
    "jobListingId" TEXT,
    "propertyListingId" TEXT,
    "externalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_metrics_daily" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "placement" "PromotionPlacementType",
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_reports" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reason" "PromotionReportReason" NOT NULL,
    "note" TEXT,
    "status" "PromotionReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "vendorProfileId" TEXT,
    "campaignId" TEXT,
    "scope" "CouponScope" NOT NULL DEFAULT 'PLATFORM',
    "discountType" "CouponDiscountType" NOT NULL,
    "percentOff" INTEGER,
    "amountOffMinor" BIGINT,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "minSpendMinor" BIGINT,
    "maxDiscountMinor" BIGINT,
    "maxUses" INTEGER,
    "perUserLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "status" "CouponStatus" NOT NULL DEFAULT 'INACTIVE',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usages" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "discountAppliedMinor" BIGINT NOT NULL DEFAULT 0,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_ownerUserId_status_idx" ON "campaigns"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_schedules_campaignId_idx" ON "campaign_schedules"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_schedules_startAt_endAt_idx" ON "campaign_schedules"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "campaign_status_history_campaignId_idx" ON "campaign_status_history"("campaignId");

-- CreateIndex
CREATE INDEX "promotions_status_idx" ON "promotions"("status");

-- CreateIndex
CREATE INDEX "promotions_ownerUserId_status_idx" ON "promotions"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "promotions_type_status_idx" ON "promotions"("type", "status");

-- CreateIndex
CREATE INDEX "promotions_campaignId_idx" ON "promotions"("campaignId");

-- CreateIndex
CREATE INDEX "promotion_placements_placement_idx" ON "promotion_placements"("placement");

-- CreateIndex
CREATE INDEX "promotion_placements_categoryId_idx" ON "promotion_placements"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_placements_promotionId_placement_categoryId_key" ON "promotion_placements"("promotionId", "placement", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_assets_storageKey_key" ON "promotion_assets"("storageKey");

-- CreateIndex
CREATE INDEX "promotion_assets_promotionId_position_idx" ON "promotion_assets"("promotionId", "position");

-- CreateIndex
CREATE INDEX "promotion_targets_promotionId_idx" ON "promotion_targets"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_targets_targetType_idx" ON "promotion_targets"("targetType");

-- CreateIndex
CREATE INDEX "promotion_targets_vendorProfileId_idx" ON "promotion_targets"("vendorProfileId");

-- CreateIndex
CREATE INDEX "promotion_targets_productId_idx" ON "promotion_targets"("productId");

-- CreateIndex
CREATE INDEX "promotion_targets_jobListingId_idx" ON "promotion_targets"("jobListingId");

-- CreateIndex
CREATE INDEX "promotion_targets_propertyListingId_idx" ON "promotion_targets"("propertyListingId");

-- CreateIndex
CREATE INDEX "promotion_metrics_daily_promotionId_day_idx" ON "promotion_metrics_daily"("promotionId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_metrics_daily_promotionId_day_placement_key" ON "promotion_metrics_daily"("promotionId", "day", "placement");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotionId_idx" ON "promotion_redemptions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_redemptions_userId_idx" ON "promotion_redemptions"("userId");

-- CreateIndex
CREATE INDEX "promotion_reports_status_idx" ON "promotion_reports"("status");

-- CreateIndex
CREATE INDEX "promotion_reports_promotionId_idx" ON "promotion_reports"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_status_idx" ON "coupons"("status");

-- CreateIndex
CREATE INDEX "coupons_vendorProfileId_idx" ON "coupons"("vendorProfileId");

-- CreateIndex
CREATE INDEX "coupons_campaignId_idx" ON "coupons"("campaignId");

-- CreateIndex
CREATE INDEX "coupon_usages_couponId_userId_idx" ON "coupon_usages"("couponId", "userId");

-- CreateIndex
CREATE INDEX "coupon_usages_userId_idx" ON "coupon_usages"("userId");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_schedules" ADD CONSTRAINT "campaign_schedules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_status_history" ADD CONSTRAINT "campaign_status_history_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_placements" ADD CONSTRAINT "promotion_placements_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_placements" ADD CONSTRAINT "promotion_placements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_assets" ADD CONSTRAINT "promotion_assets_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "employer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_agencyProfileId_fkey" FOREIGN KEY ("agencyProfileId") REFERENCES "agency_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "real_estate_agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_propertyOwnerProfileId_fkey" FOREIGN KEY ("propertyOwnerProfileId") REFERENCES "property_owner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_propertyListingId_fkey" FOREIGN KEY ("propertyListingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_metrics_daily" ADD CONSTRAINT "promotion_metrics_daily_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reports" ADD CONSTRAINT "promotion_reports_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reports" ADD CONSTRAINT "promotion_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

