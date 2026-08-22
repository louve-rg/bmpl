-- A driver earns on a marketplace delivery or on a shipment courier leg.
ALTER TABLE "driver_earnings" ALTER COLUMN "orderDeliveryId" DROP NOT NULL;
ALTER TABLE "driver_earnings" ALTER COLUMN "vendorOrderId" DROP NOT NULL;
ALTER TABLE "driver_earnings" ADD COLUMN "shipmentLegId" TEXT;

CREATE UNIQUE INDEX "driver_earnings_shipmentLegId_key" ON "driver_earnings"("shipmentLegId");

ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_shipmentLegId_fkey"
  FOREIGN KEY ("shipmentLegId") REFERENCES "shipment_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one source of the earning, so it is never ambiguous which piece of
-- work was paid for.
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_exactly_one_source"
  CHECK (num_nonnulls("orderDeliveryId", "shipmentLegId") = 1);
