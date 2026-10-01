-- BMPL-343: data model for a post-custody reroute, extending the same
-- EXCEPTION-gated primitive BMPL-183/343's return-to-sender (20261104210000)
-- already built, not a parallel path.
--
-- OWNER RULING (relayed 2026-10-01, extending OWNER-RULINGS.md Ruling 1/2):
-- never invent a reroute price and never silently charge anyone -- a reroute
-- that changes the customer's charge uses BML's normal configured pricing,
-- shows the changed cost, and requires confirmation before charging, same
-- PENDING/MANUAL fence as a return when no valid price can be calculated. A
-- reroute that does not increase the charge still needs the customer
-- informed of the material ETA change, it just does not need a payment
-- confirmation dialog for its own sake.
--
-- WHY A NEW SHIPMENT ROW, NOT A FIELD ON THE ORIGINAL. The same reason as
-- the return: Payment.shipmentId is UNIQUE (one Payment per Shipment), so a
-- reroute's own charge needs a Payment of its own, which needs a Shipment of
-- its own, booked through the same ShipmentService.create() machinery.
--
-- WHY A SEPARATE COLUMN FROM returnOfShipmentId, NOT A SHARED ONE. A reroute
-- redirects to a NEW destination the operator supplies; a return always goes
-- back to the original sender. They are different outcomes with different
-- pricing rules (a return is always the full reverse price; a reroute's
-- "does this increase the charge" question has no return equivalent), so a
-- shipment's fate is recorded as returned or rerouted through two separate
-- link fields, never one overloaded column that would have to also say
-- which kind it was.
--
-- rerouteOfShipmentId links a reroute Shipment back to the original it
-- redirects. UNIQUE, not just indexed: at most one reroute per original is
-- enforced by the database itself, the same reasoning returnOfShipmentId's
-- own comment gives. Nullable: every existing shipment is unaffected.
-- ON DELETE RESTRICT: matches returnOfShipmentId's own choice.
--
-- SCOPE FENCE (unchanged by this migration, enforced in the service layer,
-- not here): non-vendor courier shipments only, the same fence
-- loadReturnableLeg already proved by test, reused unchanged by
-- loadRerouteLeg.
--
-- Deliberately split from the AuditAction additions this feature also needs
-- (20261104220200) and from the ShipmentStatus addition BMPL-356 needs
-- (20261104220100) -- one migration per enum extension remains this floor's
-- own convention; this file touches only a table, no enum.
--
-- Additive and idempotent; no existing column, table or enum value is
-- touched, changed or removed.
--
-- ROLLBACK (same shape as 20261104210000's own, verified against a scratch
-- database, in order):
--   ALTER TABLE "shipments" DROP CONSTRAINT "shipments_rerouteOfShipmentId_fkey";
--   DROP INDEX "shipments_rerouteOfShipmentId_key";
--   ALTER TABLE "shipments" DROP COLUMN "rerouteOfShipmentId";

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "rerouteOfShipmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "shipments_rerouteOfShipmentId_key" ON "shipments"("rerouteOfShipmentId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_rerouteOfShipmentId_fkey" FOREIGN KEY ("rerouteOfShipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
