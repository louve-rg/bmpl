-- BMPL-183/343: data model for a post-custody return-to-sender.
--
-- OWNER RULING (relayed 2026-09-30, extending OWNER-RULINGS.md Ruling 1/2):
-- once a courier has taken custody of a non-vendor package, a return to
-- sender is a NEW transport service, priced with BML's normal configured
-- delivery/shipping pricing for that return movement -- calculated, shown to
-- the customer, explicitly confirmed, then charged through the existing
-- payment flow. Never a silent reversal of the original charge.
--
-- WHY A NEW SHIPMENT ROW, NOT A FIELD ON THE ORIGINAL. Payment.shipmentId is
-- UNIQUE (one Payment per Shipment) -- the original shipment's payment is
-- already settled and cannot also carry the return's separate charge. The
-- return is booked through the existing ShipmentService.create() machinery
-- (its own quote, its own plan, its own legs, its own Payment/escrow), which
-- is why it needs to be a Shipment of its own rather than new columns
-- describing a "reversed leg" on the original.
--
-- returnOfShipmentId links a return Shipment back to the original it
-- returns. UNIQUE, not just indexed: at most one return per original is
-- enforced by the database itself -- application-only uniqueness is a race
-- waiting for two staff members clicking at once. Nullable: every existing
-- shipment, and every ordinary (non-return) shipment going forward, has no
-- return and is unaffected -- Postgres exempts NULLs from a unique index, so
-- every existing row coexists. ON DELETE RESTRICT: shipments are never
-- hard-deleted today, but a return's origin must not silently disappear out
-- from under it if that ever changes.
--
-- SCOPE FENCE (unchanged by this migration, enforced in the service layer,
-- not here): non-vendor courier shipments only. Shipment.vendorOrderId being
-- set is what marks a marketplace-fulfilment shipment; this migration adds
-- no constraint referencing it; the application refuses a return on any
-- shipment where vendorOrderId is not null and a test proves it.
--
-- Deliberately split from the AuditAction additions this feature also needs
-- (20261104210100) -- one migration per enum extension is this floor's own
-- convention (see 20261104190000, 20261104200000, each containing nothing
-- but an ALTER TYPE), and a migration that both reshapes a table and extends
-- a vocabulary is harder to reason about if something goes wrong at the
-- worst possible moment, even though Postgres permits combining them.
--
-- Additive and idempotent; no existing column, table or enum value is
-- touched, changed or removed.
--
-- ROLLBACK (verified against a scratch database, in order):
--   ALTER TABLE "shipments" DROP CONSTRAINT "shipments_returnOfShipmentId_fkey";
--   DROP INDEX "shipments_returnOfShipmentId_key";
--   ALTER TABLE "shipments" DROP COLUMN "returnOfShipmentId";

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "returnOfShipmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "shipments_returnOfShipmentId_key" ON "shipments"("returnOfShipmentId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_returnOfShipmentId_fkey" FOREIGN KEY ("returnOfShipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
