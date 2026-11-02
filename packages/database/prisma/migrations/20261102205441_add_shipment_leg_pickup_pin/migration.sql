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
-- Nothing existing changes. All four columns are nullable or carry a default,
-- so every row written so far is valid with no backfill, and no app code
-- reads any of these yet (that lands in the implementation PR, not here).
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
ADD COLUMN     "pickupVerifiedAt" TIMESTAMP(3);
