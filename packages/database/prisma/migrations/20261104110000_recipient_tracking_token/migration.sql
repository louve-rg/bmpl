-- The recipient of a shipment — the member of the public the parcel is
-- actually going to — had no way to see that anything was coming: tracking is
-- scoped to the booking customer, and the recipient has no account (delivery
-- lifecycle gap #5). The smallest safe mechanism is a capability link: a
-- high-entropy token minted at booking whose holder may read a deliberately
-- minimal, status-only view. This column stores that token.
--
-- Why a stored random token and not something derivable: anything derived
-- from the reference or an id is enumerable, and a guessed URL must not
-- confirm a real shipment exists. Why nullable: shipments booked before this
-- column simply have no public link (a backfill for in-flight shipments is a
-- deliberate follow-up decision, not a side effect — production currently has
-- no bookable network, so the practical impact is nil). Why unique: the token
-- IS the lookup key, and two shipments sharing one would show a stranger's
-- parcel.
--
-- Additive and reversible; nothing else changes. One nullable column, one
-- unique index. No table, no backfill, no existing rows touched, no enum.
ALTER TABLE "shipments" ADD COLUMN "recipientToken" TEXT;
CREATE UNIQUE INDEX "shipments_recipientToken_key" ON "shipments"("recipientToken");
