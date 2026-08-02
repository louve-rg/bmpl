-- Real Estate (Phase 6 · M25) — new enums + tables. M7 search indexes preserved.
-- CreateEnum
CREATE TYPE "ListingPurpose" AS ENUM ('FOR_SALE', 'FOR_RENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'DUPLEX', 'COMMERCIAL', 'OFFICE', 'RETAIL', 'WAREHOUSE', 'INDUSTRIAL', 'LAND', 'FARM', 'RESORT', 'HOTEL', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'UNDER_OFFER', 'SOLD', 'RENTED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Furnishing" AS ENUM ('FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "Tenure" AS ENUM ('FREEHOLD', 'LEASEHOLD', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LocationVisibility" AS ENUM ('DISTRICT_ONLY', 'LOCALITY_ONLY', 'APPROXIMATE_MAP', 'EXACT_ADDRESS');

-- CreateEnum
CREATE TYPE "RentalPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "AreaUnit" AS ENUM ('SQ_FT', 'SQ_M', 'ACRE', 'HECTARE');

-- CreateEnum
CREATE TYPE "AgentSpecialty" AS ENUM ('RESIDENTIAL_SALES', 'RESIDENTIAL_RENTALS', 'COMMERCIAL', 'LAND', 'PROPERTY_MANAGEMENT', 'LUXURY', 'AGRICULTURAL', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "PropertyDocumentKind" AS ENUM ('PROOF_OF_OWNERSHIP', 'TITLE_DEED', 'OWNER_AUTHORIZATION', 'AGENT_MANDATE', 'SURVEY_PLAN', 'DISCLOSURE', 'LEASE', 'OTHER');

-- CreateEnum
CREATE TYPE "ListingAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'ENDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PropertyEnquiryType" AS ENUM ('GENERAL', 'PRICE', 'AVAILABILITY', 'FINANCING', 'RENTAL_TERMS', 'PROPERTY_DETAILS', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyEnquiryStatus" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ViewingRequestStatus" AS ENUM ('REQUESTED', 'PROPOSED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'DECLINED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PropertyReportReason" AS ENUM ('SCAM', 'INCORRECT_INFO', 'DUPLICATE', 'PROHIBITED', 'MISLEADING_PRICE', 'PRIVACY', 'DISCRIMINATION', 'ALREADY_SOLD', 'ILLEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum



-- CreateTable
CREATE TABLE "property_owner_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "district" "District",
    "contactPreference" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_owner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "real_estate_agent_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "photoKey" TEXT,
    "bio" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "agencyId" TEXT,
    "serviceDistricts" "District"[],
    "specialties" "AgentSpecialty"[],
    "yearsExperience" INTEGER,
    "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "real_estate_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_profiles" (
    "id" TEXT NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "description" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "website" TEXT,
    "district" "District",
    "addressLine1" TEXT,
    "city" TEXT,
    "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_listings" (
    "id" TEXT NOT NULL,
    "ownerProfileId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "agencyId" TEXT,
    "purpose" "ListingPurpose" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BZD',
    "rentalPeriod" "RentalPeriod",
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "district" "District",
    "locality" TEXT,
    "generalAddress" TEXT,
    "exactAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationVisibility" "LocationVisibility" NOT NULL DEFAULT 'DISTRICT_ONLY',
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "halfBathrooms" INTEGER,
    "parkingSpaces" INTEGER,
    "propertySize" DOUBLE PRECISION,
    "landSize" DOUBLE PRECISION,
    "areaUnit" "AreaUnit",
    "yearBuilt" INTEGER,
    "furnishing" "Furnishing",
    "tenure" "Tenure",
    "petPolicy" TEXT,
    "availabilityDate" TIMESTAMP(3),
    "leaseTerm" TEXT,
    "condition" TEXT,
    "videoUrl" TEXT,
    "authorityVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationReason" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "rentedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_amenities" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_utilities" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_utilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_images" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "altText" TEXT,
    "caption" TEXT,
    "areaLabel" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_documents" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "PropertyDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "label" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "scanStatus" "AttachmentScanStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_status_history" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "fromStatus" "PropertyStatus",
    "toStatus" "PropertyStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_price_history" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BZD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_listing_assignments" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ownerProfileId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "agencyId" TEXT,
    "status" "ListingAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "authorizationDocId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "property_listing_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_properties" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed_properties" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_enquiries" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "enquirerId" TEXT NOT NULL,
    "type" "PropertyEnquiryType" NOT NULL DEFAULT 'GENERAL',
    "message" TEXT NOT NULL,
    "preferredContact" TEXT,
    "contactPhone" TEXT,
    "status" "PropertyEnquiryStatus" NOT NULL DEFAULT 'OPEN',
    "respondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_viewing_requests" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "requestedTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Belize',
    "alternateDate" TIMESTAMP(3),
    "alternateTime" TEXT,
    "message" TEXT,
    "status" "ViewingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "confirmedDate" TIMESTAMP(3),
    "confirmedTime" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_viewing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_viewing_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "ViewingRequestStatus",
    "toStatus" "ViewingRequestStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_viewing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_reports" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "PropertyReportReason" NOT NULL,
    "note" TEXT,
    "status" "PropertyReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_owner_profiles_userId_key" ON "property_owner_profiles"("userId");

-- CreateIndex
CREATE INDEX "property_owner_profiles_approvalStatus_idx" ON "property_owner_profiles"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "real_estate_agent_profiles_userId_key" ON "real_estate_agent_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "real_estate_agent_profiles_slug_key" ON "real_estate_agent_profiles"("slug");

-- CreateIndex
CREATE INDEX "real_estate_agent_profiles_approvalStatus_idx" ON "real_estate_agent_profiles"("approvalStatus");

-- CreateIndex
CREATE INDEX "real_estate_agent_profiles_agencyId_idx" ON "real_estate_agent_profiles"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_profiles_managerUserId_key" ON "agency_profiles"("managerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_profiles_slug_key" ON "agency_profiles"("slug");

-- CreateIndex
CREATE INDEX "agency_profiles_approvalStatus_idx" ON "agency_profiles"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "property_listings_slug_key" ON "property_listings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "property_listings_reference_key" ON "property_listings"("reference");

-- CreateIndex
CREATE INDEX "property_listings_status_publishedAt_idx" ON "property_listings"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "property_listings_ownerProfileId_status_idx" ON "property_listings"("ownerProfileId", "status");

-- CreateIndex
CREATE INDEX "property_listings_agentProfileId_status_idx" ON "property_listings"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "property_listings_district_idx" ON "property_listings"("district");

-- CreateIndex
CREATE INDEX "property_listings_purpose_propertyType_idx" ON "property_listings"("purpose", "propertyType");

-- CreateIndex
CREATE INDEX "property_amenities_listingId_idx" ON "property_amenities"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "property_amenities_listingId_name_key" ON "property_amenities"("listingId", "name");

-- CreateIndex
CREATE INDEX "property_utilities_listingId_idx" ON "property_utilities"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "property_utilities_listingId_name_key" ON "property_utilities"("listingId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "property_images_storageKey_key" ON "property_images"("storageKey");

-- CreateIndex
CREATE INDEX "property_images_listingId_position_idx" ON "property_images"("listingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "property_documents_storageKey_key" ON "property_documents"("storageKey");

-- CreateIndex
CREATE INDEX "property_documents_listingId_idx" ON "property_documents"("listingId");

-- CreateIndex
CREATE INDEX "property_status_history_listingId_createdAt_idx" ON "property_status_history"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "property_price_history_listingId_createdAt_idx" ON "property_price_history"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "property_listing_assignments_listingId_idx" ON "property_listing_assignments"("listingId");

-- CreateIndex
CREATE INDEX "property_listing_assignments_agentProfileId_status_idx" ON "property_listing_assignments"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "saved_properties_userId_createdAt_idx" ON "saved_properties"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_properties_userId_listingId_key" ON "saved_properties"("userId", "listingId");

-- CreateIndex
CREATE INDEX "recently_viewed_properties_userId_viewedAt_idx" ON "recently_viewed_properties"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recently_viewed_properties_userId_listingId_key" ON "recently_viewed_properties"("userId", "listingId");

-- CreateIndex
CREATE INDEX "property_enquiries_listingId_status_idx" ON "property_enquiries"("listingId", "status");

-- CreateIndex
CREATE INDEX "property_enquiries_enquirerId_createdAt_idx" ON "property_enquiries"("enquirerId", "createdAt");

-- CreateIndex
CREATE INDEX "property_viewing_requests_listingId_status_idx" ON "property_viewing_requests"("listingId", "status");

-- CreateIndex
CREATE INDEX "property_viewing_requests_requesterId_createdAt_idx" ON "property_viewing_requests"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "property_viewing_events_requestId_createdAt_idx" ON "property_viewing_events"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "property_reports_status_idx" ON "property_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "property_reports_listingId_reporterId_key" ON "property_reports"("listingId", "reporterId");

-- AddForeignKey
ALTER TABLE "property_owner_profiles" ADD CONSTRAINT "property_owner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "real_estate_agent_profiles" ADD CONSTRAINT "real_estate_agent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "real_estate_agent_profiles" ADD CONSTRAINT "real_estate_agent_profiles_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agency_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_profiles" ADD CONSTRAINT "agency_profiles_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_ownerProfileId_fkey" FOREIGN KEY ("ownerProfileId") REFERENCES "property_owner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "real_estate_agent_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agency_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_utilities" ADD CONSTRAINT "property_utilities_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_status_history" ADD CONSTRAINT "property_status_history_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listing_assignments" ADD CONSTRAINT "property_listing_assignments_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listing_assignments" ADD CONSTRAINT "property_listing_assignments_ownerProfileId_fkey" FOREIGN KEY ("ownerProfileId") REFERENCES "property_owner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listing_assignments" ADD CONSTRAINT "property_listing_assignments_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "real_estate_agent_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_properties" ADD CONSTRAINT "recently_viewed_properties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_properties" ADD CONSTRAINT "recently_viewed_properties_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_enquiries" ADD CONSTRAINT "property_enquiries_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_enquiries" ADD CONSTRAINT "property_enquiries_enquirerId_fkey" FOREIGN KEY ("enquirerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_viewing_requests" ADD CONSTRAINT "property_viewing_requests_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_viewing_requests" ADD CONSTRAINT "property_viewing_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_viewing_events" ADD CONSTRAINT "property_viewing_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "property_viewing_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

