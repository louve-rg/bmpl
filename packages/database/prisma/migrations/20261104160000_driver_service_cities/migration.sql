-- Granular driver service areas (BMPL-176).
--
-- THE DEFECT: driver_service_areas carries only (driverProfileId, district,
-- isActive) with a unique (driverProfileId, district). A San Pedro courier and
-- a Belize City courier were indistinguishable, and there was no way for a
-- courier to declare they only serve part of a district. LogisticsHub already
-- carries district AND city; the provider side did not.
--
-- THE MIGRATION DECISION, stated explicitly because BMPL-176 named it as the
-- hard part: driver_service_areas is NOT touched by this migration. Not one
-- column, not one row. Its rows have always meant "I serve the whole
-- district" — that is the only thing they could mean, since no finer grain
-- existed — and that meaning does not change here. Every existing provider's
-- coverage is IDENTICAL after this migration to before it: not widened, not
-- narrowed. This is possible specifically because the finer grain is added as
-- a NEW, separate table rather than a new nullable column on the existing
-- one: there is no "what does NULL mean for an existing row" question to
-- answer, because no existing row ever gains a value in a column it didn't
-- have. The table below ships EMPTY, exactly like courier_lanes did.
--
-- THE NEW MODEL: driver_service_cities narrows a district a driver already
-- serves (per driver_service_areas) down to specific towns/cities within it.
-- No rows for a district => driver serves the whole district, unchanged. Rows
-- for a district => driver serves ONLY the listed, active cities in it. A
-- composite foreign key ties every narrowing row to its parent district row
-- (same driverProfileId + district), so a narrowing can never exist for a
-- district the driver does not currently declare, and dropping the district
-- row (as driver.service.ts#setServiceAreas already does when a driver
-- removes a district) cascades the narrowing away with it — no orphaned rows,
-- no separate cleanup code needed.
--
-- Matching a delivery/shipment to this table is left to a follow-up: this
-- migration and the API around it let a driver DECLARE city-level coverage,
-- but automatic dispatch (dispatch.service.ts, dispatch-engine.service.ts,
-- shipment-dispatch.service.ts) still matches on district only, unchanged.
-- Wiring city-level matching into dispatch needs an explicit decision about
-- how a delivery/shipment address's free-text city is compared against this
-- free-text city (exact match? case-insensitive? normalized against
-- LogisticsHub.city?) and touches files this change deliberately stays out of
-- to avoid colliding with other in-flight work on the dispatch/shipping
-- surface. See the BMPL-176 report for the full explanation.
--
-- No geography is invented here or in any fixture that uses this table: city
-- is free text, entered by the driver from a real place they name, exactly
-- like LogisticsHub.city is entered by operations.

CREATE TABLE "driver_service_cities" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "city" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_service_cities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_service_cities_driverProfileId_idx" ON "driver_service_cities"("driverProfileId");

-- Planning/matching loads one district's cities at a time.
CREATE INDEX "driver_service_cities_district_city_idx" ON "driver_service_cities"("district", "city");

-- One row per (driver, district, city): two rows saying the same narrowing is
-- an opportunity for them to disagree on isActive.
CREATE UNIQUE INDEX "driver_service_cities_driverProfileId_district_city_key" ON "driver_service_cities"("driverProfileId", "district", "city");

ALTER TABLE "driver_service_cities" ADD CONSTRAINT "driver_service_cities_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The hierarchy: a city narrowing cannot outlive, or exist without, its parent
-- district row. References driver_service_areas' own composite unique key
-- (driverProfileId, district) rather than its id, because the parent this
-- table narrows IS that (driver, district) pair, not any particular row id.
ALTER TABLE "driver_service_cities" ADD CONSTRAINT "driver_service_cities_driverProfileId_district_fkey" FOREIGN KEY ("driverProfileId", "district") REFERENCES "driver_service_areas"("driverProfileId", "district") ON DELETE CASCADE ON UPDATE CASCADE;
