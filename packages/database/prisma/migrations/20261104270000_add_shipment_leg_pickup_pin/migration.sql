-- SHIPPING-E2E step 9: the sender has no collection code to produce and the
-- driver has nothing to check against. Today collection is authorized by
-- OWNERSHIP ALONE (only the assigned driver's account can call confirmPickup),
-- same gap god/Dwight/owner confirmed independently on origin/main.
--
-- These four columns are an exact mirror of handoffPin/handoffPinAttempts/
-- handoffVerifiedAt/handoffVerificationStatus, already on this same table, for
-- the SAME reason: the party at the other end of a leg holds a code, the
-- person completing that end of the leg must produce it. Reusing the existing
-- VerificationStatus enum (PENDING/VERIFIED/OVERRIDDEN/FAILED) rather than
-- inventing a second one for the same four states, exactly as OrderDelivery's
-- pickupVerificationStatus/deliveryVerificationStatus already do.
--
-- All five columns are nullable or carry a default, so every row written so
-- far is valid with no row-by-row backfill. No app code reads any of these
-- yet (that lands in the implementation PR, not here) except as follows.
--
-- MIGRATION-DAY HAZARD (owner ruling, caught before this shipped): a missing
-- pin on an enforcing leg (FIRST_MILE/DIRECT, service needsFirstMile) is
-- designed to FAIL rather than silently pass -- but pickupPin is a brand
-- new column, so every row that exists the instant this migration applies
-- starts with pickupPin NULL, including shipments already booked and
-- waiting to be collected. Enforcing against those would lock every one of
-- them into EXCEPTION on migration day, one by one -- a self-inflicted
-- outage this migration itself would cause.
--
-- pickupPinGrandfathered is the fix: ADD COLUMN with DEFAULT true applies
-- true to every row that already exists the moment this statement runs,
-- then the very next statement flips the column's own default to false, so
-- EVERY row inserted afterward -- which always gets a real pickupPin from
-- ShipmentService.legData() -- starts false and is enforced exactly as
-- ruling 1 requires. This is a one-time default-flip, not a backfill: no
-- UPDATE statement touches a single row, and the final state (DB default
-- false) matches the Prisma schema's own @default(false) with no drift for
-- `migrate diff` to flag. Do not "clean up" the DEFAULT true -- it already
-- stopped applying to anything the instant the next statement ran; dropping
-- or changing it later changes nothing live and only risks re-opening this
-- exact hazard for whoever edits this file next without reading this
-- comment (packages/database/CLAUDE.md §6, mechanism (4), is the same shape
-- of trap: a deliberate, asymmetric default left in place on purpose).
--
-- The DROP INDEX statements `prisma migrate dev` proposed for
-- products_search_idx/products_title_trgm_idx are OMITTED on purpose — they
-- are hand-written GIN trigram indexes on an Unsupported column that Prisma
-- cannot see and proposes dropping on every diff, unrelated to this change.
-- See packages/database/CLAUDE.md §6, mechanism (1).

-- AlterTable
ALTER TABLE "shipment_legs" ADD COLUMN     "pickupPin" TEXT,
ADD COLUMN     "pickupPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pickupVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "pickupVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "pickupPinGrandfathered" BOOLEAN NOT NULL DEFAULT true;

-- Flip the default for every row inserted from here on, per the comment above.
ALTER TABLE "shipment_legs" ALTER COLUMN "pickupPinGrandfathered" SET DEFAULT false;
