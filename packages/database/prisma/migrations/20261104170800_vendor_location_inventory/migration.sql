-- Vendor location-level inventory and fulfilment-origin selection (BMPL-175,
-- Edward req 1), owner-approved 2026-09-30. Two purely additive pieces,
-- nothing existing touched, nothing backfilled:
--
--   1. inventory_locations — a new CHILD table, one row per
--      (inventory row, vendor location) pair, carrying quantity/reserved AT
--      THAT LOCATION. The parent `inventory` table is completely unchanged —
--      same columns, same constraints — and keeps its present single-bucket
--      meaning for any product that never adopts a location. This table
--      ships with ZERO rows: no product anywhere has location-tracked stock
--      until a vendor with 2+ locations explicitly records some, so this
--      migration changes the behaviour of nothing on the day it deploys.
--
--      WHY A CHILD TABLE RATHER THAN A locationId COLUMN ON `inventory`
--      ITSELF: `inventory` already carries inventory_product_default_key (a
--      partial unique index guaranteeing at most one product-level row,
--      `"variantId" IS NULL`) and a separate unique constraint on
--      `variantId`. Adding locationId directly to that table would force
--      both to grow a dimension and would make "the inventory row for
--      productId+variantId" ambiguous everywhere it is queried today
--      (rowFor, checkout, publicAvailability, summaryFor, inStockMap — nine
--      call sites, none of them expecting a location filter). A child table
--      instead extends the SAME sum-across-rows fan-out those three
--      availability functions already perform one level up (across sibling
--      `inventory` rows for one productId, e.g. variants) rather than
--      inventing a new aggregation shape for this one.
--
--   2. vendor_orders.originLocationId — a new NULLABLE column recording
--      which vendor location fulfilled the order. NULL means "not
--      recorded"; every row that exists before this migration runs gets
--      NULL and stays NULL PERMANENTLY — no backfill is attempted. A
--      vendor's CURRENT primary location is not evidence of which location
--      fulfilled a PAST order (vendors add, remove and re-flag isPrimary
--      over time), so a guessed origin would be a fabricated fact in the
--      record, indistinguishable from a real one forever. See BMPL-175's
--      design record in the floor's tasks.json for the full reasoning this
--      migration implements.
--
-- CLOSEST EXISTING PRECEDENT, for mechanical comparison rather than a
-- description of the similarity: 20261104170700_vendor_hours_exceptions —
-- a new child table with FK(s) to an existing parent, ON DELETE CASCADE, a
-- composite unique key, no CHECK needed here (there is no cross-column
-- coherence rule to enforce, unlike that table's MODIFIED/CLOSED pair), no
-- data migration, ships empty. vendor_orders.originLocationId follows that
-- same table's own existing nullable pointer columns
-- (assignedDriverProfileId, assignedVehicleId, assignedByUserId on
-- OrderDelivery; reviewerId on VendorModerationReview) — a plain nullable
-- FK column, SET NULL on delete, no default, no backfill.
--
-- RESERVATION SAFETY (BMPL-256, restated because it is the one thing this
-- migration cannot enforce structurally): `reserved` on inventory_locations
-- is written ONLY through the same SELECT ... FOR UPDATE-then-check-then-
-- write discipline as `inventory.reserved` — enforced in
-- InventoryService, not by this schema. This migration does not add a
-- second way to reserve stock; it adds a second TABLE that the existing
-- discipline is mirrored onto, exactly once per checkout line, chosen
-- before reserving.

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- One row per (product-or-variant, shop) — a second row for the same pair
-- would just split one location's stock across two numbers that could drift.
CREATE UNIQUE INDEX "inventory_locations_inventoryId_locationId_key" ON "inventory_locations"("inventoryId", "locationId");

CREATE INDEX "inventory_locations_locationId_idx" ON "inventory_locations"("locationId");

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "vendor_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: append-only history gets an optional pointer to WHICH location
-- an adjustment was scoped to. Null (every existing row, and every
-- product-level adjustment from here on) means exactly what it always
-- meant — a change to the parent row.
ALTER TABLE "inventory_changes" ADD COLUMN "locationId" TEXT;

-- AddForeignKey
ALTER TABLE "inventory_changes" ADD CONSTRAINT "inventory_changes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "vendor_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: fulfilment origin. Nullable, no default — see header.
ALTER TABLE "vendor_orders" ADD COLUMN "originLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "vendor_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
