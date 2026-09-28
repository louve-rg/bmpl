-- Sender/recipient availability windows (BMPL-184 / BMPL-284 / BMPL-285) —
-- storage and the sender write surface only. No consumer this round: no
-- gating anywhere reads this table yet, deliberately.
--
-- ONE TABLE, deliberately NOT shaped like hub_opening_days or
-- route_operating_days. Those two exist because a terminal or a route
-- operates INDEFINITELY across recurring days, so their shape is a weekly
-- default plus date-specific exceptions. A shipment is a ONE-TIME event —
-- it has one pickup attempt and (at most) one delivery attempt, ever. "9-12,
-- 2-5" is two acceptable ranges for THAT ONE occasion, not Monday versus
-- Tuesday — there is no weekly axis and no date-exception axis to model, so
-- this is a short, flat list: one row per time range, a role telling the
-- reader which door-touching attempt it governs, nothing else. Reusing the
-- weekly-pattern-plus-exception shape here would build complexity for an
-- axis that does not exist in this problem (BMPL-284's own finding).
--
-- Lives on the SHIPMENT, not shipment_legs, matching the existing
-- convention that a door-touching leg's location detail already lives on
-- the parent shipment: shipment_legs carries no originAddress/
-- destinationAddress columns of its own — a FIRST_MILE leg's origin and a
-- LAST_MILE leg's destination are read from shipments.originAddress /
-- shipments.destinationAddress. A window fits the exact same slot as
-- shipments.originInstructions / destinationInstructions.
--
-- role SENDER governs the FIRST_MILE pickup attempt; role RECIPIENT governs
-- the LAST_MILE delivery attempt. Multiple rows per role are expected and
-- normal (the "9-12, 2-5" case) — nothing here deduplicates or merges
-- adjacent/overlapping ranges, at this layer or the API's; that is
-- deliberately out of scope for BMPL-285, which asked for start/end
-- validation only.
--
-- SHIPS EMPTY. No shipment gets a window, and nothing backfills one — this
-- is new, additive, optional data, the same "a new table changes nothing
-- for what already exists" rule 20261104170100_hub_operating_hours already
-- follows. ABSENCE MEANS "ATTEMPT AT ANY TIME" — not by analogy to hub
-- hours' unconstrained default, but independently: nothing anywhere gates
-- dispatch on sender/recipient availability today, so a windowless
-- shipment behaving exactly as every shipment behaves right now is the
-- only choice that does not regress the instant this table exists. That
-- reasoning belongs with the code that reads it, not just here — see
-- ShipmentService.setAvailabilityWindows' own comment.
CREATE TYPE "AvailabilityWindowRole" AS ENUM ('SENDER', 'RECIPIENT');

CREATE TABLE "shipment_availability_windows" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "role" "AvailabilityWindowRole" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_availability_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipment_availability_windows_shipmentId_role_idx" ON "shipment_availability_windows"("shipmentId", "role");

ALTER TABLE "shipment_availability_windows" ADD CONSTRAINT "shipment_availability_windows_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "HH:MM" is zero-padded 24-hour (enforced at the API by the same
-- timeOfDaySchema hub/vendor hours use), so plain text comparison sorts
-- identically to clock order — the same reasoning that lets hub hours'
-- resolver compare these strings directly without parsing them into a time
-- type.
--
-- DELIBERATELY "!=", NOT "<". A strict startTime < endTime CHECK would
-- permanently forbid an overnight window (22:00-02:00) — the EXACT shape
-- Michael already refused for hub_hours_exceptions on BMPL-263, for the
-- same reason: it would convert "not supported yet" into "structurally
-- impossible", and there is no evidence anywhere in this codebase that an
-- overnight pickup/delivery attempt is actually excluded — no
-- delivery-hours concept exists, DriverAvailability has no time-of-day
-- axis, and the dispatch sweeper runs on a flat interval with no time
-- gating at all. "!=" only forbids the one genuinely meaningless input in
-- either direction: a zero-duration window.
--
-- PERMITTING STORAGE OBLIGATES THE FUTURE CONSUMER. There is no consumer
-- yet (BMPL-285 scope), which is exactly why this has to be said HERE,
-- before one exists: the first membership check written against this table
-- will reach for `startTime <= t && t < endTime`, and EVERY OVERNIGHT ROW
-- WILL SILENTLY NEVER MATCH — reintroducing hub-hours' own documented
-- limitation in a new place, by someone who never knew they were choosing
-- it. Whoever builds that consumer must decide EXPLICITLY how an overnight
-- window (endTime < startTime) is interpreted, not assume a simple range
-- comparison. Same warning is repeated where the window is validated
-- (packages/validation/src/shipping.ts) and where the model is declared
-- (schema.prisma), so it is waiting at every point a future author might
-- reach for this table without reading the others first.
ALTER TABLE "shipment_availability_windows" ADD CONSTRAINT "shipment_availability_windows_not_zero_duration"
    CHECK ("startTime" != "endTime");

-- The sender replaced their shipment's availability windows — one audit
-- action per replace-all write, the same "whole set, one action" shape
-- HUB_HOURS_CHANGED already uses, not one row per range changed.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_AVAILABILITY_WINDOWS_SET';
