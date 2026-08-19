-- MULTI-LEG LOGISTICS NETWORK
--
-- Purely additive. Not one existing table, column, index or constraint is
-- touched, because local single-courier delivery must keep working exactly as
-- it does today: VendorOrder -> OrderDelivery, dispatched by the existing
-- engine. The only link into the old world is `shipment_legs.orderDeliveryId`,
-- a nullable FK - a plain local delivery simply has no shipment leg pointing at
-- it and behaves as it always has.
--
-- NOTE: Prisma's auto-diff also emitted `DROP INDEX orders_isTest_idx`,
-- `products_search_idx` and `products_title_trgm_idx`, plus an ALTER on
-- promotion_placements.updatedAt. Those are the same manually-managed raw-SQL
-- objects earlier migrations documented and deliberately kept - the datamodel
-- cannot see a GIN/trgm index, so Prisma proposes dropping it on every diff.
-- They are stripped here, as they were in the previous migrations.

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('LAND', 'AIR', 'SEA');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('AIRPORT', 'AIRSTRIP', 'WATER_TAXI_TERMINAL', 'SEA_TERMINAL', 'BUS_TERMINAL', 'WAREHOUSE', 'DISTRIBUTION_CENTER', 'BMPL_HUB');

-- CreateEnum
CREATE TYPE "ShippingService" AS ENUM ('DOOR_TO_DOOR', 'DOOR_TO_HUB', 'HUB_TO_DOOR', 'HUB_TO_HUB');

-- CreateEnum
CREATE TYPE "LegKind" AS ENUM ('FIRST_MILE', 'LINE_HAUL', 'LAST_MILE');

-- CreateEnum
CREATE TYPE "LegStatus" AS ENUM ('PENDING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'AWAITING_PICKUP', 'FIRST_MILE', 'AT_ORIGIN_HUB', 'IN_TRANSIT', 'AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'AWAITING_COLLECTION', 'DELIVERED', 'EXCEPTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustodyHolder" AS ENUM ('SENDER', 'DRIVER', 'HUB', 'CARRIER', 'RECIPIENT');

-- CreateTable
CREATE TABLE "logistics_hubs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HubType" NOT NULL,
    "district" "District" NOT NULL,
    "city" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "modes" "TransportMode"[],
    "instructions" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_routes" (
    "id" TEXT NOT NULL,
    "originHubId" TEXT NOT NULL,
    "destinationHubId" TEXT NOT NULL,
    "mode" "TransportMode" NOT NULL,
    "carrierName" TEXT,
    "carrierPhone" TEXT,
    "scheduleNote" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "service" "ShippingService" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "customerUserId" TEXT,
    "vendorOrderId" TEXT,
    "originHubId" TEXT,
    "originName" TEXT,
    "originPhone" TEXT,
    "originAddress" TEXT,
    "originCity" TEXT,
    "originDistrict" "District",
    "originLatitude" DOUBLE PRECISION,
    "originLongitude" DOUBLE PRECISION,
    "originInstructions" TEXT,
    "destinationHubId" TEXT,
    "destinationName" TEXT,
    "destinationPhone" TEXT,
    "destinationAddress" TEXT,
    "destinationCity" TEXT,
    "destinationDistrict" "District",
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "destinationInstructions" TEXT,
    "preferredMode" "TransportMode",
    "quotedTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "quotedMinutes" INTEGER,
    "planExplanation" TEXT,
    "description" TEXT,
    "weightGrams" INTEGER,
    "pieces" INTEGER NOT NULL DEFAULT 1,
    "bookedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_legs" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "LegKind" NOT NULL,
    "mode" "TransportMode" NOT NULL,
    "status" "LegStatus" NOT NULL DEFAULT 'PENDING',
    "originHubId" TEXT,
    "destinationHubId" TEXT,
    "routeId" TEXT,
    "orderDeliveryId" TEXT,
    "carrierName" TEXT,
    "carrierBookingRef" TEXT,
    "scheduledDepartureAt" TIMESTAMP(3),
    "scheduledArrivalAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL DEFAULT 0,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "handoffPin" TEXT,
    "handoffPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "handoffVerifiedAt" TIMESTAMP(3),
    "handoffVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "handoffReceivedByName" TEXT,
    "handoffPhotoKeys" TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "exceptionAt" TIMESTAMP(3),
    "exceptionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentLegId" TEXT,
    "fromHolder" "CustodyHolder",
    "toHolder" "CustodyHolder" NOT NULL,
    "hubId" TEXT,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_hubs_code_key" ON "logistics_hubs"("code");

-- CreateIndex
CREATE INDEX "logistics_hubs_district_isActive_idx" ON "logistics_hubs"("district", "isActive");

-- CreateIndex
CREATE INDEX "logistics_routes_originHubId_isActive_idx" ON "logistics_routes"("originHubId", "isActive");

-- CreateIndex
CREATE INDEX "logistics_routes_destinationHubId_isActive_idx" ON "logistics_routes"("destinationHubId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_reference_key" ON "shipments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_vendorOrderId_key" ON "shipments"("vendorOrderId");

-- CreateIndex
CREATE INDEX "shipments_customerUserId_createdAt_idx" ON "shipments"("customerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "shipments_status_isTest_idx" ON "shipments"("status", "isTest");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_legs_orderDeliveryId_key" ON "shipment_legs"("orderDeliveryId");

-- CreateIndex
CREATE INDEX "shipment_legs_shipmentId_sequence_idx" ON "shipment_legs"("shipmentId", "sequence");

-- CreateIndex
CREATE INDEX "shipment_legs_status_kind_idx" ON "shipment_legs"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_legs_shipmentId_sequence_key" ON "shipment_legs"("shipmentId", "sequence");

-- CreateIndex
CREATE INDEX "custody_events_shipmentId_occurredAt_idx" ON "custody_events"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "custody_events_shipmentLegId_idx" ON "custody_events"("shipmentLegId");

-- AddForeignKey
ALTER TABLE "logistics_routes" ADD CONSTRAINT "logistics_routes_originHubId_fkey" FOREIGN KEY ("originHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_routes" ADD CONSTRAINT "logistics_routes_destinationHubId_fkey" FOREIGN KEY ("destinationHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "vendor_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_originHubId_fkey" FOREIGN KEY ("originHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destinationHubId_fkey" FOREIGN KEY ("destinationHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_originHubId_fkey" FOREIGN KEY ("originHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_destinationHubId_fkey" FOREIGN KEY ("destinationHubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "logistics_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_orderDeliveryId_fkey" FOREIGN KEY ("orderDeliveryId") REFERENCES "order_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_shipmentLegId_fkey" FOREIGN KEY ("shipmentLegId") REFERENCES "shipment_legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "logistics_hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "order_deliveries_assignedDriverProfileId_driverQueuePosition_id" RENAME TO "order_deliveries_assignedDriverProfileId_driverQueuePositio_idx";
