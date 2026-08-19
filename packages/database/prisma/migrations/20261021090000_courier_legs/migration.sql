-- COURIER LEGS ARE DRIVER WORK
--
-- A first- or last-mile shipment leg is a real driver job, so it gains the same
-- assignment shape a delivery already has. `courierStatus` reuses the existing
-- DeliveryStatus enum on purpose: the driver app's state machine, view mapping
-- and next-action helpers then apply to a shipment leg with no new vocabulary
-- and no new branches.
--
-- Additive only. order_deliveries is not touched - ordinary local delivery keeps
-- exactly the shape and behaviour it has today.
--
-- NOTE: the DROP INDEX / promotion_placements statements Prisma's auto-diff
-- emits are the same manually-managed raw-SQL drift earlier migrations
-- documented and deliberately kept. Stripped here, as before.

-- AlterTable
ALTER TABLE "shipment_legs" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "arrivingAt" TIMESTAMP(3),
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedDriverProfileId" TEXT,
ADD COLUMN     "assignedVehicleId" TEXT,
ADD COLUMN     "courierStatus" "DeliveryStatus",
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchExhaustedAt" TIMESTAMP(3),
ADD COLUMN     "driverQueuePosition" INTEGER,
ADD COLUMN     "inTransitAt" TIMESTAMP(3),
ADD COLUMN     "offerCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "offerExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "shipment_legs_assignedDriverProfileId_courierStatus_idx" ON "shipment_legs"("assignedDriverProfileId", "courierStatus");

-- CreateIndex
CREATE INDEX "shipment_legs_assignedDriverProfileId_driverQueuePosition_idx" ON "shipment_legs"("assignedDriverProfileId", "driverQueuePosition");

-- CreateIndex
CREATE INDEX "shipment_legs_offerExpiresAt_idx" ON "shipment_legs"("offerExpiresAt");

-- CreateIndex
CREATE INDEX "shipment_legs_status_kind_courierStatus_idx" ON "shipment_legs"("status", "kind", "courierStatus");

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_assignedDriverProfileId_fkey" FOREIGN KEY ("assignedDriverProfileId") REFERENCES "driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "driver_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
