-- COURIER LEG OFFER HISTORY
--
-- The CURRENT offer is denormalized onto the leg for fast reads; this table is
-- the record of everyone who was ever asked. It is what stops the dispatcher
-- offering the same leg to the same driver twice, and what answers "why did this
-- parcel wait four hours" after the fact.
--
-- Mirrors delivery_assignments deliberately, down to the status enum, so the two
-- kinds of driver work have the same shape of history.
--
-- Additive only. NOTE: the DROP INDEX / promotion_placements statements Prisma's
-- auto-diff emits are the pre-existing raw-SQL drift earlier migrations
-- documented and deliberately kept; stripped here, as before.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_OFFERED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_OFFER_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_DISPATCH_EXHAUSTED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_PICKED_UP';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_IN_TRANSIT';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_ARRIVING';
ALTER TYPE "AuditAction" ADD VALUE 'SHIPMENT_LEG_DRIVER_ASSIGNED';


-- CreateTable
CREATE TABLE "shipment_leg_offers" (
    "id" TEXT NOT NULL,
    "shipmentLegId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_leg_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_leg_offers_shipmentLegId_assignedAt_idx" ON "shipment_leg_offers"("shipmentLegId", "assignedAt");

-- CreateIndex
CREATE INDEX "shipment_leg_offers_driverProfileId_status_idx" ON "shipment_leg_offers"("driverProfileId", "status");

-- AddForeignKey
ALTER TABLE "shipment_leg_offers" ADD CONSTRAINT "shipment_leg_offers_shipmentLegId_fkey" FOREIGN KEY ("shipmentLegId") REFERENCES "shipment_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_leg_offers" ADD CONSTRAINT "shipment_leg_offers_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_leg_offers" ADD CONSTRAINT "shipment_leg_offers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "driver_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
