-- Carrier route operating-day CONFIGURATION capability (BMPL-186).
--
-- WHAT WAS WRONG. LogisticsRoute.scheduleNote is a free-text label ("Mon/Wed/Fri
-- 09:00") nobody, including the planner, can check by machine. There was no
-- way for a carrier (or an admin, on their behalf) to say "we do not run
-- Wednesdays" or "we are closed 2026-12-25" in a way any code could act on.
-- The owner ruled BMPL-186 explicitly: build this CAPABILITY now; the DATA
-- (which routes run when) stays gated exactly like hubs, routes and courier
-- lanes always have — entered later, from a real carrier, through the product.
--
-- THE FIX. Two tables, mirroring the VendorOpeningHours / VendorProfile shape
-- (root CLAUDE.md: a rule stated twice eventually disagrees with itself, so
-- BMPL-177's hub/business hours should reuse this SAME shape rather than a
-- second one): route_operating_days is the weekly default, one row per
-- day-of-week; route_schedule_exceptions is a date-specific override — a
-- known future closure, a holiday, a one-off reduced run. Absence of a row
-- means "operating", so an unconfigured route (every route today) behaves
-- exactly as before. Both scope on routeId with ON DELETE CASCADE: deleting a
-- route's schedule history along with the route itself is correct, unlike
-- deleting the route's own shipment/leg history.
--
-- ALTERNATIVES REJECTED. A single JSON blob column on LogisticsRoute: not
-- queryable ("which routes are closed on 2026-12-25"), not indexable, and
-- every future report over it would have to parse the routes table's own
-- rows one at a time. A boolean-only status (no REDUCED state): the batch
-- requirement (Edward #11/#5) explicitly separates "not operating" from "a
-- reduced service", and collapsing the two loses a real distinction a carrier
-- needs to communicate. A shared polymorphic schedule table for every
-- schedulable entity (route, hub, business): Prisma cannot express a
-- polymorphic FK cleanly, and this codebase's precedent (ShippingProviderProfile
-- vs PassengerProviderProfile) is to keep verticals on their own tables with a
-- shared SHAPE rather than one shared table — so BMPL-177 gets its own
-- LogisticsHub-scoped and VendorProfile-scoped tables of the same shape, not
-- a foreign key into this one.
--
-- WHAT DOES NOT CHANGE. Both new tables ship EMPTY — no real carrier schedule
-- is entered here or anywhere in this change. LogisticsRoute.scheduleNote
-- keeps its existing meaning as a human-readable label; these tables are the
-- machine-checkable layer alongside it, not a replacement. Existing routes,
-- legs and shipments are entirely unaffected: an unconfigured route already
-- behaved as "always operating", which is exactly what an absent row still
-- means. No existing row, column or index is touched.
--
-- PERMISSIONS (enforced in application code, not here): a carrier configures
-- only a route where LogisticsRoute.operatedByProviderId is one of their
-- ACTIVE-membership organizations (the same scoping ShippingProviderService
-- already uses for legs); admin acts under logistics.manage/logistics.read,
-- same as route CRUD itself.
--
-- ROLLBACK (verified against a scratch database, in order):
--   ALTER TABLE "route_schedule_exceptions" DROP CONSTRAINT "route_schedule_exceptions_createdByUserId_fkey";
--   ALTER TABLE "route_schedule_exceptions" DROP CONSTRAINT "route_schedule_exceptions_routeId_fkey";
--   ALTER TABLE "route_operating_days" DROP CONSTRAINT "route_operating_days_routeId_fkey";
--   DROP TABLE "route_schedule_exceptions";
--   DROP TABLE "route_operating_days";
--   DROP TYPE "ServiceOperatingStatus";
--   -- AuditAction value stays: enum values are never removed once a row could hold one.

-- CreateEnum
CREATE TYPE "ServiceOperatingStatus" AS ENUM ('OPERATING', 'REDUCED', 'NOT_OPERATING');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_SCHEDULE_CHANGED';

-- CreateTable
CREATE TABLE "route_operating_days" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "status" "ServiceOperatingStatus" NOT NULL DEFAULT 'OPERATING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_operating_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_schedule_exceptions" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ServiceOperatingStatus" NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "route_operating_days_routeId_dayOfWeek_key" ON "route_operating_days"("routeId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "route_schedule_exceptions_routeId_date_key" ON "route_schedule_exceptions"("routeId", "date");

-- AddForeignKey
ALTER TABLE "route_operating_days" ADD CONSTRAINT "route_operating_days_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "logistics_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_schedule_exceptions" ADD CONSTRAINT "route_schedule_exceptions_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "logistics_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_schedule_exceptions" ADD CONSTRAINT "route_schedule_exceptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
