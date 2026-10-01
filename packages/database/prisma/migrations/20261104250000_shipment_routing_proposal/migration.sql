-- BMPL-375: the line between "staff proposed this" and "the paying customer
-- agreed to be charged for it" -- owner ruling, verbatim in substance:
-- "Staff may initiate or prepare a post-custody return, but staff action
-- alone must NEVER authorize charging the customer's wallet" and
-- "payWithWallet: true must not transform an operational staff action into
-- customer payment consent."
--
-- WHAT WAS WRONG. ShipmentService#returnToSender and #rerouteShipment
-- (20261104210000, 20261104230000) both computed a real configured price
-- and then IMMEDIATELY called create()->payments.createForShipment->
-- escrowInTx, charging the customer's wallet, gated only on a STAFF
-- permission (logistics.manage). Each method's own comment said so plainly:
-- "this method itself always treats being called as the explicit
-- confirmation" -- true for an ordinary booking, where the CALLER is the
-- paying customer; false here, where the caller is staff. That is exactly
-- the defect the owner named.
--
-- THE FIX. Split the staff action from the payment authorization. Staff
-- (logistics.manage) now PREPARES a return or a charge-increasing reroute,
-- which writes exactly one shipment_routing_proposals row and NOTHING ELSE
-- money-shaped -- no Payment, no escrow, no linked return/reroute Shipment.
-- The ORIGINAL shipment keeps reading EXCEPTION, not RETURNED/REROUTED,
-- until the row is consumed: nothing may read as charged, paid, escrowed or
-- reserved while a proposal sits unconfirmed (owner's own instruction --
-- a false financial status is worse than an incomplete one). Only the
-- shipment's own customerUserId, confirming through a separate
-- customer-scoped action, reads this row, recomputes the price FRESH
-- (service-layer rule, never trusts what is stored here), and only then
-- calls the existing, unchanged create()/payment/escrow flow -- at which
-- point the row is deleted, consumed by the shipment it produced.
--
-- A reroute that does NOT increase the charge is unaffected by this table
-- at all: it still executes immediately on staff action alone, because
-- there is no charge to consent to -- only the customer-confirmation path
-- changes, never the charge-free one.
--
-- ONE ROW PER LEG (legId UNIQUE): a leg cannot have two competing
-- proposals, and loading "the" proposal for a leg is never ambiguous.
-- ON DELETE CASCADE: a proposal cannot outlive the leg it describes.
--
-- destination is REROUTE-only (RerouteInput['destination'], already
-- Zod-validated on the way in via rerouteSchema, frozen as JSONB at
-- prepare time) so confirmation does not require the customer, or a
-- second staff round-trip, to resupply it. NULL for RETURN: the reversed
-- trip is fully derived from the shipment's own stored origin, exactly as
-- previewReturn/returnToSender already compute it fresh every time -- never
-- stored, because it is never a choice anyone but the shipment itself made.
--
-- SHIPMENT_RETURN_PREPARED / SHIPMENT_REROUTE_PREPARED are new, directly
-- tied to this table and meaningless without it, so added in the same
-- migration rather than split into a second file -- the existing
-- SHIPMENT_RETURN_INITIATED / SHIPMENT_REROUTE_INITIATED actions are
-- unchanged and now fire only once a real charge/shipment exists,
-- regardless of whether staff (a free reroute) or the customer (a
-- confirmed charge) triggered it.
--
-- Additive and idempotent; no existing column, table or enum value is
-- touched, changed or removed.
--
-- ROLLBACK (verified against a scratch database, in order):
--   ALTER TABLE "shipment_routing_proposals" DROP CONSTRAINT "shipment_routing_proposals_legId_fkey";
--   DROP TABLE "shipment_routing_proposals";
--   DROP TYPE "ShipmentRoutingProposalKind";
--   -- AuditAction values stay: enum values are never removed.

-- CreateEnum
CREATE TYPE "ShipmentRoutingProposalKind" AS ENUM ('RETURN', 'REROUTE');

-- CreateTable
CREATE TABLE "shipment_routing_proposals" (
    "id" TEXT NOT NULL,
    "legId" TEXT NOT NULL,
    "kind" "ShipmentRoutingProposalKind" NOT NULL,
    "destination" JSONB,
    "note" TEXT NOT NULL,
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_routing_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_routing_proposals_legId_key" ON "shipment_routing_proposals"("legId");

-- AddForeignKey
ALTER TABLE "shipment_routing_proposals" ADD CONSTRAINT "shipment_routing_proposals_legId_fkey"
    FOREIGN KEY ("legId") REFERENCES "shipment_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_RETURN_PREPARED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_REROUTE_PREPARED';
