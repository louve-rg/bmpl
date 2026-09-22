-- Carrier organizations (BMPL-137), part 2 of 2 — the structure.
--
-- WHAT WAS WRONG. Every transport-leg operation is staff-gated under
-- logistics.*, and the domain's only notion of "who runs this leg" is
-- carrierName, a free-text label. The SHIPPING_PROVIDER role exists and is
-- approvable, but with zero consumers: an approved carrier is connected to
-- nothing, so no provider-facing surface could ever be authorized, and in UAT
-- an assigned carrier could not mark their own San Pedro -> Belize City leg
-- departed (BMPL-138's diagnosis).
--
-- THE FIX. The organization becomes a row. shipping_provider_profiles is the
-- org behind an approved SHIPPING_PROVIDER role (the VendorProfile /
-- PassengerProviderProfile precedent, created the same self-service way);
-- shipping_provider_members is who may act for it (OWNER row born with the
-- profile, STAFF admin-managed; scoping matches user id + ACTIVE membership,
-- never active role). shipment_legs.operatedByProviderId is the authorization
-- anchor the provider surface scopes on; logistics_routes.operatedByProviderId
-- is the standing operator copied onto new legs at booking so operations
-- assign a carrier once per route.
--
-- ALTERNATIVES REJECTED. A user-level leg link (built, tested, then discarded
-- unapplied — the BMPL-137 prior art): cannot represent a carrier with two
-- employees, dangles every open leg when one person leaves, and would need a
-- second migration for the org model later — two migrations for one concept.
-- Matching on carrierName text: authorizing money-adjacent operations on a
-- string anybody can mistype.
--
-- WHAT DOES NOT CHANGE. Both tables ship EMPTY — real carriers are business
-- onboarding through the product, never seeded. Existing legs and routes keep
-- NULL (no operator; staff continue exactly as before). carrierName keeps its
-- meaning as the display label. Courier legs are untouched: they are BML
-- driver work and never carry an org. SET NULL on both new FKs: deleting a
-- profile can never orphan or destroy leg history. No rows are modified.
--
-- ROLLBACK (verified against a scratch database, in order):
--   ALTER TABLE "logistics_routes" DROP COLUMN "operatedByProviderId";
--   ALTER TABLE "shipment_legs" DROP COLUMN "operatedByProviderId";
--   DROP TABLE "shipping_provider_members";
--   DROP TABLE "shipping_provider_profiles";
--   DROP TYPE "ShippingProviderMemberStatus";
--   DROP TYPE "ShippingProviderMemberRole";
--   -- AuditAction values from part 1 stay: enum values are never removed.

-- CreateEnum
CREATE TYPE "ShippingProviderMemberRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "ShippingProviderMemberStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "shipping_provider_profiles" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "description" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "district" "District",
    "city" TEXT,
    "addressLine1" TEXT,
    "operatingLicenceNumber" TEXT,
    "operatingLicenceExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_provider_members" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberRole" "ShippingProviderMemberRole" NOT NULL DEFAULT 'STAFF',
    "status" "ShippingProviderMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_provider_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_provider_profiles_userId_key" ON "shipping_provider_profiles"("userId");

-- CreateIndex
CREATE INDEX "shipping_provider_profiles_isActive_isTest_idx" ON "shipping_provider_profiles"("isActive", "isTest");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_provider_members_providerProfileId_userId_key" ON "shipping_provider_members"("providerProfileId", "userId");

-- CreateIndex
CREATE INDEX "shipping_provider_members_userId_status_idx" ON "shipping_provider_members"("userId", "status");

-- AddForeignKey
ALTER TABLE "shipping_provider_profiles" ADD CONSTRAINT "shipping_provider_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_provider_members" ADD CONSTRAINT "shipping_provider_members_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "shipping_provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_provider_members" ADD CONSTRAINT "shipping_provider_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "shipment_legs" ADD COLUMN "operatedByProviderId" TEXT;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_operatedByProviderId_fkey" FOREIGN KEY ("operatedByProviderId") REFERENCES "shipping_provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "shipment_legs_operatedByProviderId_status_idx" ON "shipment_legs"("operatedByProviderId", "status");

-- AlterTable
ALTER TABLE "logistics_routes" ADD COLUMN "operatedByProviderId" TEXT;

-- AddForeignKey
ALTER TABLE "logistics_routes" ADD CONSTRAINT "logistics_routes_operatedByProviderId_fkey" FOREIGN KEY ("operatedByProviderId") REFERENCES "shipping_provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
