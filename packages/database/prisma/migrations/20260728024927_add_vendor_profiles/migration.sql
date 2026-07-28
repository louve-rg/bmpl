-- CreateEnum
CREATE TYPE "VendorApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'RESTORED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_PROFILE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_RESTORED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MARKETPLACE';

-- CreateTable
CREATE TABLE "vendor_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "storeStatus" "StoreStatus" NOT NULL DEFAULT 'CLOSED',
    "rejectionReason" TEXT,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settings" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vacationMode" BOOLEAN NOT NULL DEFAULT false,
    "minimumOrderMinor" BIGINT,
    "deliveryRadiusKm" INTEGER,
    "taxesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoAcceptOrders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_locations" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BZ',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_opening_hours" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vendor_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_moderation_reviews" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "action" "ModerationAction" NOT NULL,
    "note" TEXT,
    "fromStatus" "VendorApprovalStatus",
    "toStatus" "VendorApprovalStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_moderation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_profiles_userId_key" ON "vendor_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_profiles_slug_key" ON "vendor_profiles"("slug");

-- CreateIndex
CREATE INDEX "vendor_profiles_approvalStatus_idx" ON "vendor_profiles"("approvalStatus");

-- CreateIndex
CREATE INDEX "vendor_profiles_storeStatus_idx" ON "vendor_profiles"("storeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settings_vendorProfileId_key" ON "vendor_settings"("vendorProfileId");

-- CreateIndex
CREATE INDEX "vendor_locations_vendorProfileId_idx" ON "vendor_locations"("vendorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_opening_hours_vendorProfileId_dayOfWeek_key" ON "vendor_opening_hours"("vendorProfileId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "vendor_moderation_reviews_vendorProfileId_idx" ON "vendor_moderation_reviews"("vendorProfileId");

-- AddForeignKey
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "vendor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settings" ADD CONSTRAINT "vendor_settings_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_locations" ADD CONSTRAINT "vendor_locations_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_opening_hours" ADD CONSTRAINT "vendor_opening_hours_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_moderation_reviews" ADD CONSTRAINT "vendor_moderation_reviews_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_moderation_reviews" ADD CONSTRAINT "vendor_moderation_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
