-- Recipient account linking, part 2 of 2 — the structure.
--
-- WHAT WAS MISSING. shipments.recipientToken already gives the person a
-- parcel is coming to a high-entropy, unguessable capability link for a
-- deliberately minimal status-only view (20261104110000). But there was no
-- way for that link to become part of the recipient's own BML account: no
-- column recorded "this account is the recipient", so an incoming shipment
-- could never appear in anyone's own account, and nothing downstream (such
-- as authorizing recipient access to the package pickup photo) had anything
-- to authorize against.
--
-- THE FIX. recipientUserId is a plain nullable link to the account that
-- claimed the shipment as its recipient, set ONLY by a deliberate, audited
-- claim action (shipment.service.ts#claimAsRecipient) that a signed-in
-- account performs against the SAME recipientToken capability link —
-- possessing the token still only proves you may read the public tracking
-- view; claiming is a second, explicit step. recipientClaimedAt is a plain
-- timestamp of when that happened, kept as a column (not only in the audit
-- log) so "linked since" is a cheap read.
--
-- WHY NOT DERIVE IT FROM destinationEmail/destinationPhone. Those are
-- customer-typed snapshot text, not verified account identifiers — matching
-- on them would silently attach a shipment to whichever account happens to
-- share that email or phone (or worse, let a claim probe whether a given
-- email/phone has an account, exactly the enumeration leak this card was
-- told to avoid). The claim path never reads or compares them.
--
-- WHAT DOES NOT CHANGE. Every existing shipment keeps recipientUserId NULL —
-- unclaimed, working exactly as it does today; account creation and claiming
-- remain entirely optional. recipientToken, the human handoff PIN, and the
-- anonymous trackPublic() allowlist are untouched by this migration; the
-- claim path is additive to them, never a replacement. SET NULL on the new
-- FK: deleting a user account can never destroy shipment history.
--
-- ROLLBACK (verified against a scratch database, in order):
--   DROP INDEX "shipments_recipientUserId_createdAt_idx";
--   ALTER TABLE "shipments" DROP CONSTRAINT "shipments_recipientUserId_fkey";
--   ALTER TABLE "shipments" DROP COLUMN "recipientClaimedAt";
--   ALTER TABLE "shipments" DROP COLUMN "recipientUserId";
--   -- AuditAction value from part 1 stays: enum values are never removed.

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "recipientUserId" TEXT;
ALTER TABLE "shipments" ADD COLUMN "recipientClaimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "shipments_recipientUserId_createdAt_idx" ON "shipments"("recipientUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
