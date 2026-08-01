-- CreateEnum
CREATE TYPE "ReviewSubjectType" AS ENUM ('PRODUCT', 'VENDOR', 'DRIVER');

-- CreateEnum
CREATE TYPE "ReviewContextType" AS ENUM ('ORDER_ITEM', 'VENDOR_ORDER', 'ORDER_DELIVERY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'IRRELEVANT', 'PROHIBITED', 'PRIVACY', 'FRAUDULENT');

-- CreateEnum
CREATE TYPE "ReviewReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReviewMediaStatus" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "subjectType" "ReviewSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "contextType" "ReviewContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT true,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "variantId" TEXT,
    "variantName" TEXT,
    "sku" TEXT,
    "optionsSnapshot" JSONB,
    "moderatedById" TEXT,
    "moderationReason" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_media" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "status" "ReviewMediaStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_responses" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReviewReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReviewReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_helpful_votes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_subjectType_subjectId_status_idx" ON "reviews"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "reviews_reviewerId_idx" ON "reviews"("reviewerId");

-- CreateIndex
CREATE INDEX "reviews_status_idx" ON "reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_reviewerId_subjectType_contextId_key" ON "reviews"("reviewerId", "subjectType", "contextId");

-- CreateIndex
CREATE UNIQUE INDEX "review_media_storageKey_key" ON "review_media"("storageKey");

-- CreateIndex
CREATE INDEX "review_media_reviewId_idx" ON "review_media"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "review_responses_reviewId_key" ON "review_responses"("reviewId");

-- CreateIndex
CREATE INDEX "review_reports_status_idx" ON "review_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_reviewId_reporterId_key" ON "review_reports"("reviewId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "review_helpful_votes_reviewId_userId_key" ON "review_helpful_votes"("reviewId", "userId");

-- AddForeignKey
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

