-- A payment can now belong to a shipment as well as to an order.
--
-- Both columns are nullable and unique, and the CHECK below enforces that
-- exactly one is set, so a payment always points at exactly one payable thing
-- through a real foreign key.
ALTER TABLE "payments" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN "shipmentId" TEXT;

CREATE UNIQUE INDEX "payments_shipmentId_key" ON "payments"("shipmentId");

ALTER TABLE "payments" ADD CONSTRAINT "payments_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one payable resource. Not "at least one" — a payment pointing at both
-- an order and a shipment would make settlement ambiguous.
ALTER TABLE "payments" ADD CONSTRAINT "payments_exactly_one_resource"
  CHECK (num_nonnulls("orderId", "shipmentId") = 1);
