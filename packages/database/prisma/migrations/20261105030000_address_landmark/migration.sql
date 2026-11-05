-- A landmark the customer gives us ("behind the blue gate") must survive from
-- a saved address all the way to a booked order or shipment, the same way a
-- street address and a pin already do. Found missing (MDF-533, owner
-- ruling): SavedAddress already carries a landmark (20261105020000), but
-- neither place that snapshots a customer address at booking time had
-- anywhere to put one -- a column no one can write and nothing carries,
-- which is exactly the disconnected implementation the owner banned.
--
-- order_addresses: one nullable column, copied in at checkout from the saved
-- address picked (orders.service.ts), exactly like every other field on this
-- row -- still a byte-for-byte snapshot, no FK, unaffected by a later edit to
-- the saved address.
--
-- shipments: two nullable columns, originLandmark/destinationLandmark,
-- mirroring the existing originInstructions/destinationInstructions pair --
-- a shipment booked DOOR-side from a saved address has the identical gap a
-- marketplace order did, confirmed by reading shipment.service.ts's booking
-- path and endpointSchema (packages/validation/src/shipping.ts), neither of
-- which had a landmark field either.
--
-- Nothing existing changes. All three columns are nullable with no default
-- backfill needed -- every row written so far simply has no landmark, same
-- as it has no instructions until someone writes one.

ALTER TABLE "order_addresses" ADD COLUMN "landmark" TEXT;
ALTER TABLE "shipments" ADD COLUMN "originLandmark" TEXT;
ALTER TABLE "shipments" ADD COLUMN "destinationLandmark" TEXT;
