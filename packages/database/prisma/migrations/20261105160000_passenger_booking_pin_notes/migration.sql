-- MDF-548: a passenger booking's pickup/dropoff snapshot (20260000000000-era
-- PassengerBooking columns -- district/city/address/latitude/longitude,
-- already present on both ends) had the same gap SavedAddress/OrderAddress
-- had before MDF-485/533: no landmark, and no instructions either. A
-- flag-stop rider who pins a stop along the route and adds "behind the blue
-- gate, past the gas station" had nowhere for either half of that note to
-- land.
--
-- Four nullable columns, mirroring the existing pickup*/dropoff* pairs:
-- pickupLandmark, pickupInstructions, dropoffLandmark, dropoffInstructions.
-- Snapshot semantics unchanged -- these are plain columns on
-- passenger_bookings, no FK anywhere, written once at booking time exactly
-- like the ten columns already there, so a later edit to anything upstream
-- can never retroactively change a booking already made.
--
-- Nothing existing changes. All four columns are nullable with no backfill
-- needed -- every row written so far simply has no landmark or instructions,
-- same as it has no pickup/dropoff pin yet either.

ALTER TABLE "passenger_bookings" ADD COLUMN "pickupLandmark" TEXT;
ALTER TABLE "passenger_bookings" ADD COLUMN "pickupInstructions" TEXT;
ALTER TABLE "passenger_bookings" ADD COLUMN "dropoffLandmark" TEXT;
ALTER TABLE "passenger_bookings" ADD COLUMN "dropoffInstructions" TEXT;
