-- Dispatch & Delivery Execution (Phase 4 · M15) — types, tables, columns.
-- Enum ADD VALUEs were applied in the preceding migration.

-- CreateEnum
CREATE TYPE "DeliveryAssignmentStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'DECLINED', 'REASSIGNED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'OVERRIDDEN', 'FAILED');

-- AlterTable: operational + verification fields on the delivery record
ALTER TABLE "order_deliveries" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "arrivingAt" TIMESTAMP(3),
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedByUserId" TEXT,
ADD COLUMN     "assignedDriverProfileId" TEXT,
ADD COLUMN     "assignedVehicleId" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "deliveryPin" TEXT,
ADD COLUMN     "deliveryPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "deliveryVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "inTransitAt" TIMESTAMP(3),
ADD COLUMN     "inventoryFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "pickupConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "pickupPin" TEXT,
ADD COLUMN     "pickupPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pickupVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "pickupVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "podPhotoKeys" TEXT[],
ADD COLUMN     "reassignedAt" TIMESTAMP(3),
ADD COLUMN     "reassignmentReason" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "signatureKey" TEXT;

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" TEXT NOT NULL,
    "orderDeliveryId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "assignedByUserId" TEXT,
    "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_timeline_events" (
    "id" TEXT NOT NULL,
    "orderDeliveryId" TEXT NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus",
    "event" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_assignments_orderDeliveryId_assignedAt_idx" ON "delivery_assignments"("orderDeliveryId", "assignedAt");

-- CreateIndex
CREATE INDEX "delivery_assignments_driverProfileId_status_idx" ON "delivery_assignments"("driverProfileId", "status");

-- CreateIndex
CREATE INDEX "delivery_timeline_events_orderDeliveryId_createdAt_idx" ON "delivery_timeline_events"("orderDeliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "order_deliveries_assignedDriverProfileId_status_idx" ON "order_deliveries"("assignedDriverProfileId", "status");

-- AddForeignKey
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_assignedDriverProfileId_fkey" FOREIGN KEY ("assignedDriverProfileId") REFERENCES "driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "driver_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_orderDeliveryId_fkey" FOREIGN KEY ("orderDeliveryId") REFERENCES "order_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "driver_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_timeline_events" ADD CONSTRAINT "delivery_timeline_events_orderDeliveryId_fkey" FOREIGN KEY ("orderDeliveryId") REFERENCES "order_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
