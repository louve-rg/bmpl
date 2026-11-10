-- TERM-12 / MDF-645 (owner's §7): recipient collection at a hub-ending
-- terminal took a typed name and verified nothing — neither of the two
-- existing PIN mechanisms apply here. ShipmentService.pinFor/pickupPinFor
-- deliberately null out handoffPin/pickupPin whenever a leg ends/starts at
-- a hub rather than a door, and even setting that aside, reusing either
-- would hand the recipient's collection credential to a party who already
-- legitimately knew it (the courier/carrier who handed the parcel TO the
-- hub already presented that same leg's handoffPin to get it there) — a
-- genuinely separate secret is required, not a reveal of an existing one.
--
-- THE FIX. collectionPin/collectionPinAttempts/collectionVerificationStatus,
-- same shape as ShipmentLeg's own handoff/pickup columns: the recipient
-- holds the code (revealed to CUSTOMER audience only while the shipment is
-- AWAITING_COLLECTION, same gating style as pinFor), the person at the
-- counter must produce it, verified with the same timing-safe comparison
-- and five-attempt lockout shape (ShipmentService.verifyCollectionPinOrThrow,
-- the implementation PR, not this migration).
--
-- GRANDFATHER, same mechanism as pickupPinGrandfathered
-- (20261102205441_add_shipment_leg_pickup_pin / 3a756d35's own migration
-- comment): collectionPin is a brand new column, so every shipment that
-- exists the instant this migration applies starts with collectionPin
-- NULL, including shipments already sitting at AWAITING_COLLECTION right
-- now, waiting for someone to walk in. Requiring a code from those would
-- lock every one of them out of collection on deploy day — a self-inflicted
-- outage this migration itself would cause. collectionPinGrandfathered:
-- ADD COLUMN DEFAULT true applies true to every row that already exists
-- the moment this statement runs; the next statement flips the column's
-- own default to false, so every shipment booked afterward — which always
-- gets a real collectionPin from ShipmentService's booking transaction —
-- starts false and is enforced. One-time default-flip, not a backfill: no
-- UPDATE statement touches a single row. Do not "clean up" the interim
-- DEFAULT true later — see packages/database/CLAUDE.md §6 and the
-- pickupPinGrandfathered migration's own comment for why that default
-- already stopped applying to anything the instant the next statement ran.
--
-- ROLLBACK (verified against a scratch database):
--   ALTER TABLE "shipments" DROP COLUMN "collectionPin";
--   ALTER TABLE "shipments" DROP COLUMN "collectionPinAttempts";
--   ALTER TABLE "shipments" DROP COLUMN "collectionVerificationStatus";
--   ALTER TABLE "shipments" DROP COLUMN "collectionPinGrandfathered";

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "collectionPin" TEXT,
ADD COLUMN     "collectionPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "collectionVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "collectionPinGrandfathered" BOOLEAN NOT NULL DEFAULT true;

-- Flip the default for every row inserted from here on, per the comment above.
ALTER TABLE "shipments" ALTER COLUMN "collectionPinGrandfathered" SET DEFAULT false;
