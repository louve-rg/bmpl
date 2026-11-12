-- MDF-709 (TERM-CODE-API), critical: the collection journey could not be
-- completed by a real person. serialize()'s own `collectionCode` field
-- already reaches a CUSTOMER audience and never STAFF (shipment.service.ts
-- :4639-4642 as of this card) -- but `track()`'s CUSTOMER audience check
-- is `shipment.customerUserId !== viewer.userId`, which is the SENDER only.
-- A linked RECIPIENT gets the exact same 404 a stranger would. For a
-- service that ends at a hub (no LAST_MILE), there was never a handoff
-- code either -- the recipient had no in-app way to learn their own
-- collection code at all, linked or not.
--
-- THE FIX (implementation PR, not this migration):
--   1. ShipmentService.recipientCollectionCode -- a linked recipient's own
--      narrow read, exact mirror of the existing recipientDeliveryCode.
--   2. ShipmentService.requestCollectionCodeEmail / revealCollectionCode --
--      the same two-step, token-gated, no-oracle reveal
--      requestDeliveryCodeEmail/revealDeliveryCode already established for
--      the handoff code, for an UNLINKED recipient holding only the public
--      recipientToken. Kept on its OWN set of token columns below, never
--      reusing deliveryCodeRevealToken/etc, so requesting one code can
--      never clear or race the other's in-flight token.
--   3. transition()/resolveException() now also notify the RECIPIENT (if
--      linked) the moment the shipment reaches AWAITING_COLLECTION --
--      notifyCustomer (shipment.service.ts:3594-3607) only ever reached the
--      sender. The notification never carries the code itself.
--   4. STAFF stays null unconditionally -- serialize()'s existing gate is
--      untouched by this migration or the implementation PR.
--
-- GRANDFATHER: none needed here, unlike collectionPin's own migration
-- (20261109235500). These three columns are request-time state for an
-- OPTIONAL reveal flow, not a requirement gate -- a shipment with none of
-- the three set simply has no reveal in flight, which is every row today
-- and most of the time for every row created after this, too.
--
-- ROLLBACK (verified against a scratch database):
--   ALTER TABLE "shipments" DROP COLUMN "collectionCodeRevealToken";
--   ALTER TABLE "shipments" DROP COLUMN "collectionCodeRevealTokenExpiresAt";
--   ALTER TABLE "shipments" DROP COLUMN "collectionCodeRevealRequestedAt";
--   (The two new AuditAction values cannot be removed -- see
--   packages/database/CLAUDE.md §2 -- not reversible by any migration.)

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "collectionCodeRevealToken" TEXT,
ADD COLUMN     "collectionCodeRevealTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "collectionCodeRevealRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_collectionCodeRevealToken_key" ON "shipments"("collectionCodeRevealToken");

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_COLLECTION_CODE_REVEALED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_COLLECTION_CODE_EMAIL_REQUESTED';
