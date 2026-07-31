-- Phase 4 · M13 — Delivery & Shipping Foundation (data model only; no execution).

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING_ASSIGNMENT');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryFeeMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendor_settings" ADD COLUMN     "baseDeliveryFeeMinor" BIGINT,
ADD COLUMN     "freeDeliveryThresholdMinor" BIGINT;

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districts" "District"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_rates" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_estimates" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "minHours" INTEGER NOT NULL,
    "maxHours" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_deliveries" (
    "id" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "freeApplied" BOOLEAN NOT NULL DEFAULT false,
    "estimateMinHours" INTEGER,
    "estimateMaxHours" INTEGER,
    "estimateLabel" TEXT,
    "instructions" TEXT,
    "appliedZoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_zones_vendorProfileId_idx" ON "delivery_zones"("vendorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_rates_zoneId_key" ON "delivery_rates"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_estimates_vendorProfileId_key" ON "delivery_estimates"("vendorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "order_deliveries_vendorOrderId_key" ON "order_deliveries"("vendorOrderId");

-- CreateIndex
CREATE INDEX "order_deliveries_status_idx" ON "order_deliveries"("status");

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_estimates" ADD CONSTRAINT "delivery_estimates_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "vendor_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
