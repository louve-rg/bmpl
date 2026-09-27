-- Structured terminal hours (BMPL-177 / BMPL-260 / BMPL-262) — the
-- CONFIGURATION half. LogisticsHub.instructions stays exactly what it was: a
-- free-text label ("which counter, what hours") that nothing reads to build
-- these rows and that these rows never overwrite. This migration does not
-- touch, read or parse `instructions` in any way — a parsed guess at a
-- hub's real hours would become indistinguishable from a configured fact
-- forever, the same failure mode BMPL-175 named for a delivery's origin.
--
-- Two tables, mirroring an existing pair rather than inventing a shape:
--
--   hub_opening_days: the weekly default. Same FIELD shape as
--   vendor_opening_hours (dayOfWeek / openTime "HH:MM" / closeTime / isClosed)
--   because a counter's hours answer "is someone there between two clock
--   times" — the same question vendor hours already answer for a storefront
--   — not "does a scheduled departure run today", which is what
--   route_operating_days' status enum exists for. Stands as its own table
--   rather than sharing vendor_opening_hours': a hub has no owning vendor
--   user and is configured by operations under admin authorization, not a
--   vendor's own self-service dashboard — the same reason route_operating_days
--   already stands apart from vendor_opening_hours despite both being "a
--   weekly pattern for a business entity".
--
--   hub_hours_exceptions: a date-specific override, mirroring
--   route_schedule_exceptions' STRUCTURE (one row per hub+date, a status, a
--   truthful `reason`, an audit trail — see 20261104160000_carrier_route_
--   schedule, that table's own migration) rather than copying its ENUM: an
--   ordinary closure and a public holiday are the SAME row here, distinguished
--   only by `reason`, so the status only needs to say CLOSED (full day, no
--   override times) or MODIFIED (open, but not at the usual hours — openTime
--   and/or closeTime below carry the override). There is no third value
--   because there is no case where recording "unchanged from the weekly
--   default" would mean anything an absent row does not already mean.
--
-- Both tables SHIP EMPTY, exactly like courier_lanes and
-- route_operating_days/route_schedule_exceptions before them: no hub gets a
-- row here, and with none, every existing hub's behaviour is unaffected —
-- the resolver this pairs with (packages/shared) treats "no rows" as
-- unconstrained, not as "closed", so this migration changes nothing about
-- any hub on the day it deploys. A real row is entered later by operations
-- from verified information.

-- CreateEnum
CREATE TYPE "HubHoursExceptionStatus" AS ENUM ('CLOSED', 'MODIFIED');

-- CreateTable
CREATE TABLE "hub_opening_days" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hub_opening_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_hours_exceptions" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "HubHoursExceptionStatus" NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_hours_exceptions_pkey" PRIMARY KEY ("id")
);

-- One row per hub per weekday — a second row for the same day would just be
-- an opportunity for it to disagree with the first.
CREATE UNIQUE INDEX "hub_opening_days_hubId_dayOfWeek_key" ON "hub_opening_days"("hubId", "dayOfWeek");

-- One decision per hub per date — same reasoning as route_schedule_exceptions.
CREATE UNIQUE INDEX "hub_hours_exceptions_hubId_date_key" ON "hub_hours_exceptions"("hubId", "date");

-- AddForeignKey
ALTER TABLE "hub_opening_days" ADD CONSTRAINT "hub_opening_days_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "logistics_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_hours_exceptions" ADD CONSTRAINT "hub_hours_exceptions_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "logistics_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_hours_exceptions" ADD CONSTRAINT "hub_hours_exceptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
