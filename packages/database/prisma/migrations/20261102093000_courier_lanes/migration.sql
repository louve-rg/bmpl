-- Two towns one courier can drive between.
--
-- The planner recognised exactly one journey that needs no terminal: both ends
-- in the same town. Everything else was sent to the hub network, so Belize City
-- → Ladyville — fifteen minutes up the Northern Highway — was refused unless
-- somebody invented a bus terminal at each end. That is not a routing answer;
-- it is the planner never having been told something true about the road.
--
-- It cannot be guessed. Belize City and San Pedro share the Belize District and
-- one of them is on an island, so a district-wide rule would have despatched a
-- road courier across open water. Which towns share a road is a fact about
-- Belize, configured by operations, not derived from a district column.
--
-- Ships EMPTY. No lane is created here, and with no rows the planner behaves
-- exactly as it does today. Real lanes are configured as the service actually
-- covers them.

CREATE TABLE "courier_lanes" (
    "id" TEXT NOT NULL,
    "originDistrict" "District" NOT NULL,
    "originCity" TEXT NOT NULL,
    "destinationDistrict" "District" NOT NULL,
    "destinationCity" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_lanes_pkey" PRIMARY KEY ("id")
);

-- One row per pair of towns: two rows saying one fact is an opportunity for
-- them to disagree.
CREATE UNIQUE INDEX "courier_lanes_originDistrict_originCity_destinationDistrict_destinationCity_key"
    ON "courier_lanes" ("originDistrict", "originCity", "destinationDistrict", "destinationCity");

-- Planning loads one side of the simulation boundary at a time.
CREATE INDEX "courier_lanes_isTest_isActive_idx" ON "courier_lanes" ("isTest", "isActive");

-- Configuring a lane is an operator decision with money attached to it, so it
-- belongs in the same audit trail as opening a terminal or adding a route.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURIER_LANE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURIER_LANE_UPDATED';
