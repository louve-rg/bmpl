-- Recipient account linking, part 2 of 3 — the structure.
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
-- MATCHING SIGNAL REQUIRED (owner decision, 2026-09-30 — revises this
-- migration's original "why not derive it" paragraph, kept in git history
-- rather than pretended away). Two OWNER-RULINGS.md rulings force this
-- between them: ruling 12 says a tracking token proves possession of a
-- link, never authorization, which rules out "first authenticated claimant
-- wins"; ruling 7 already contemplates "an authenticated recipient who has
-- been legitimately linked to, or has CLAIMED" a shipment, so a claim step
-- is expected to exist and to mean something. A matching signal — the
-- claiming account's OWN email or phone, already on file, equalling
-- destinationEmail/destinationPhone — is the minimum authorization
-- consistent with both: it does not require a sender round-trip, and it is
-- strictly more than link possession alone. destinationEmail/destinationPhone
-- are still never echoed back on a failed claim (see claimAsRecipient's own
-- comment) — comparing them server-side is not the same as exposing them.
--
-- WHAT DOES NOT CHANGE. Every existing shipment keeps recipientUserId NULL —
-- unclaimed, working exactly as it does today; account creation and claiming
-- remain entirely optional. recipientToken, the human handoff PIN, and the
-- anonymous trackPublic() allowlist are untouched by this migration; the
-- claim path is additive to them, never a replacement. SET NULL on the new
-- FK: deleting a user account can never destroy shipment history.
--
-- recipientClaimAttempts (added alongside, same migration, still unapplied
-- anywhere — see recipientClaimAttempts' own field comment in schema.prisma)
-- is the rate limit a real matching step now needs: ShipmentLeg's own
-- handoffPinAttempts precedent, applied to a claim instead of a handoff
-- code. Per-SHIPMENT, not per-account, so the limit cannot be laundered by
-- registering a fresh account per guess.
--
-- ROLLBACK (verified against a scratch database, in order):
--   DROP INDEX "shipments_recipientUserId_createdAt_idx";
--   ALTER TABLE "shipments" DROP CONSTRAINT "shipments_recipientUserId_fkey";
--   ALTER TABLE "shipments" DROP COLUMN "recipientClaimAttempts";
--   ALTER TABLE "shipments" DROP COLUMN "recipientClaimedAt";
--   ALTER TABLE "shipments" DROP COLUMN "recipientUserId";
--   -- AuditAction values from part 1 / part 3 stay: enum values are never removed.

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "recipientUserId" TEXT;
ALTER TABLE "shipments" ADD COLUMN "recipientClaimedAt" TIMESTAMP(3);
ALTER TABLE "shipments" ADD COLUMN "recipientClaimAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "shipments_recipientUserId_createdAt_idx" ON "shipments"("recipientUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
