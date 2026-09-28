-- Vendor date-specific hours overrides (BMPL-334), the exceptions half of
-- BMPL-177's business half (BMPL-259 ruling 10). VendorOpeningHours already
-- gives a vendor a recurring weekly pattern; nothing let a vendor record a
-- one-off closure — a public holiday, a family emergency, an extended-hours
-- day — the way HubHoursException already lets a terminal. Ruling 10 says
-- defer rather than FABRICATE AVAILABILITY; without this table, every
-- vendor-hours-aware dispatch decision fabricates availability on exactly
-- the days a vendor is actually closed but has no weekly row saying so.
--
-- This is a mirror of hub_hours_exceptions
-- (20261104170100_hub_operating_hours), not a shared table or a shared
-- Postgres enum: hub hours and vendor hours already stand as separate
-- tables despite an identical field shape — that migration's own header
-- gives the reason (different permission surfaces, a hub has no owning
-- vendor user) — and the same reasoning applies to their exceptions.
-- Column-for-column, constraint-for-constraint identical otherwise,
-- including the CHECK below, character-for-character the same expression
-- as hub_hours_exceptions_times_match_status.
--
-- CLOSED (full day, no override times) or MODIFIED (open, but not at the
-- usual hours — openTime AND closeTime carry the override, both or
-- neither, never one alone: a partial override would have to silently
-- merge with the weekly row's close time to mean anything, and that is a
-- surprise generator, not this design). No third value, same reasoning as
-- the hub side: there is no case where recording "unchanged from the
-- weekly default" would mean anything an absent row does not already mean.
--
-- Self-service: this table is reached through the vendor's own
-- PUT/POST vendor/profile/hours* routes (@Roles('VENDOR'), scoped to the
-- caller's own profile), the same surface vendor_opening_hours already
-- uses — not an admin-authorized write like hub_hours_exceptions.
--
-- Ships empty, exactly like hub_hours_exceptions and vendor_opening_hours
-- before it: no vendor gets a row here, and with none, every existing
-- vendor's behaviour is unaffected — the resolver (packages/shared)
-- treats "no rows" as unconstrained, not as "closed", so this migration
-- changes nothing about any vendor on the day it deploys. A real row is
-- entered later by the vendor from their own real schedule; no plausible-
-- looking Belize public holiday is fabricated here or in any fixture that
-- exercises this table.

-- CreateEnum
CREATE TYPE "VendorHoursExceptionStatus" AS ENUM ('CLOSED', 'MODIFIED');

-- CreateTable
CREATE TABLE "vendor_hours_exceptions" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "VendorHoursExceptionStatus" NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_hours_exceptions_pkey" PRIMARY KEY ("id")
);

-- One decision per vendor per date — same reasoning as hub_hours_exceptions.
CREATE UNIQUE INDEX "vendor_hours_exceptions_vendorProfileId_date_key" ON "vendor_hours_exceptions"("vendorProfileId", "date");

-- AddForeignKey
ALTER TABLE "vendor_hours_exceptions" ADD CONSTRAINT "vendor_hours_exceptions_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_hours_exceptions" ADD CONSTRAINT "vendor_hours_exceptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MODIFIED carries both openTime and closeTime; CLOSED carries neither. A
-- MODIFIED row with only one time set would silently resolve to "open all
-- day" (the resolver requires both to compare against), and a CLOSED row
-- with times set would carry an override nothing ever reads — both are the
-- same incoherence, a row claiming something it does not actually carry.
-- Character-for-character the same expression as
-- hub_hours_exceptions_times_match_status.
ALTER TABLE "vendor_hours_exceptions" ADD CONSTRAINT "vendor_hours_exceptions_times_match_status"
  CHECK (
    (status = 'MODIFIED' AND num_nonnulls("openTime", "closeTime") = 2)
    OR (status = 'CLOSED' AND num_nonnulls("openTime", "closeTime") = 0)
  );
