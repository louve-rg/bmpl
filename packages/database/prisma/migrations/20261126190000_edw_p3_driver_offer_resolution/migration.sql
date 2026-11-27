-- EDW-P3: tell an offer the driver REFUSED apart from one that merely ran out
-- of time.
--
-- WHAT WAS WRONG. Both dispatch surfaces close a lapsed offer by writing the
-- byte-for-byte same row an explicit refusal writes:
--
--   delivery_assignments   status = 'DECLINED'  (dispatch-engine.service.ts,
--                          expireOffer)          endReason = 'Offer expired'
--   shipment_leg_offers    status = 'DECLINED'  (shipment-dispatch.service.ts,
--                          expireOffer)          declineReason = 'Offer expired.'
--
-- and a driver's own refusal writes status = 'DECLINED' too, in both tables.
-- `DeliveryAssignmentStatus` has no EXPIRED value, so status alone cannot
-- answer "did this driver decide, or did nobody hear from them" — and the
-- courier-leg side is worse than the delivery side, because it puts its
-- expiry note in `declineReason`, the SAME free-text column a driver's own
-- typed reason goes into. The only incidental difference left was that the
-- expiry paths never set `respondedAt` and the refusal paths always do.
--
-- That mattered for a product decision, not just for tidiness: once automatic
-- dispatch has cycled through every eligible driver, the lists a driver sees
-- have to treat "I passed on this" differently from "I never saw the
-- notification". A timeout is not an answer. A missed push is not a refusal.
-- Neither may permanently remove a job from a driver's Available list.
--
-- THE FIX. One new nullable column on each of the two offer tables, holding a
-- new two-value enum:
--
--   DECLINED_BY_DRIVER  the driver answered, and the answer was no
--   EXPIRED             the clock ran out with no answer
--
-- WHY NOT 'EXPIRED' ON DeliveryAssignmentStatus. Two reasons, both about not
-- breaking things that already work:
--   * that enum is shared with `passenger_trip_assignments`, where an expiring
--     offer has no meaning yet — an unused value sitting there is an
--     invitation to write one by accident;
--   * every query that filters status = 'DECLINED' today (the ops waiting
--     counts, DriverOperationsService's per-driver decline tally, the
--     append-only history reads) would silently change meaning the moment
--     some of those rows moved to a different value. `status` keeps saying
--     exactly what it has always said; this column says the thing it could
--     never say.
--
-- WHAT THIS DOES TO EXISTING ROWS. One scoped UPDATE per table, and nothing
-- else:
--
--   status = 'DECLINED' AND "respondedAt" IS NOT NULL  ->  DECLINED_BY_DRIVER
--
-- `respondedAt` is written on exactly one code path in each table — the
-- driver's own decline (DriverJobService.decline, ShipmentDriverService.
-- decline) and acceptance — and never by either expiry sweeper, so a DECLINED
-- row carrying one is stored evidence that a human answered. Verified against
-- every writer of each table before this was written: the remaining
-- `DECLINED` writers are the two expiry sweepers (no `respondedAt`), and the
-- reassign/cancel/complete paths all use their own statuses (REASSIGNED,
-- CANCELLED, COMPLETED), not DECLINED.
--
-- EVERY OTHER ROW IS LEFT NULL, DELIBERATELY. In particular,
-- status = 'DECLINED' AND "respondedAt" IS NULL is NOT backfilled to EXPIRED.
-- It is very probably an expiry, but "very probably" is not evidence, and the
-- owner's instruction is explicit: do not infer a historical explicit decline
-- where the stored evidence cannot establish one. NULL is read as "not
-- established" by the query layer, and "not established" is never treated as
-- an explicit pass — so an unclassifiable historical row errs toward showing
-- the driver the job, which is the direction that cannot wrongly exclude
-- anybody. Nothing is lost by leaving it NULL either: the query layer treats
-- NULL and EXPIRED identically.
--
-- WHAT DOES NOT CHANGE. No column is dropped, renamed or retyped. No existing
-- value is rewritten. `status`, `respondedAt`, `endedAt`, `declineReason` and
-- `endReason` all keep their current meaning and contents, including the
-- 'Offer expired' / 'Offer expired.' notes, which stay exactly as they are as
-- the historical record. Additive and reversible: dropping the column would
-- restore the previous shape without touching any pre-existing data.

CREATE TYPE "DriverOfferResolution" AS ENUM ('DECLINED_BY_DRIVER', 'EXPIRED');

ALTER TABLE "delivery_assignments" ADD COLUMN "resolution" "DriverOfferResolution";
ALTER TABLE "shipment_leg_offers" ADD COLUMN "resolution" "DriverOfferResolution";

-- The one question the Available/Unclaimed lists ask of these tables: "has
-- THIS driver explicitly passed on any of this batch of jobs".
CREATE INDEX "delivery_assignments_driverProfileId_resolution_idx" ON "delivery_assignments"("driverProfileId", "resolution");
CREATE INDEX "shipment_leg_offers_driverProfileId_resolution_idx" ON "shipment_leg_offers"("driverProfileId", "resolution");

-- Scoped backfill: only rows whose own stored evidence establishes an explicit
-- refusal. See the header for why the complementary set is left NULL rather
-- than assumed to be EXPIRED.
UPDATE "delivery_assignments"
   SET "resolution" = 'DECLINED_BY_DRIVER'
 WHERE "status" = 'DECLINED'
   AND "respondedAt" IS NOT NULL;

UPDATE "shipment_leg_offers"
   SET "resolution" = 'DECLINED_BY_DRIVER'
 WHERE "status" = 'DECLINED'
   AND "respondedAt" IS NOT NULL;
