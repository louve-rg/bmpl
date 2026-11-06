-- CLOSE-2: secure recipient access to the delivery (handoff) code, without
-- exposing it publicly.
--
-- WHAT WAS MISSING. The handoff code was only ever visible to the SENDER
-- (serialize()'s CUSTOMER audience, keyed on customerUserId). The recipient
-- infrastructure already built for BMPL-359 (recipientToken, recipientUserId,
-- recipientView/trackPublic/trackAsRecipient) deliberately NEVER includes the
-- code, by design — recipientView's own header: "the two-party handoff
-- survives a leaked link only if the link cannot complete one." That
-- invariant is correct and untouched here. What was missing is that even a
-- GENUINELY LINKED recipient (recipientUserId set via the audited
-- claimAsRecipient step) had no path to their own code at all, and an
-- unlinked recipient (no BML account) had none either.
--
-- THE FIX, two paths:
--   1. A linked recipient reads it straight off their own account
--      (ShipmentService.recipientDeliveryCode) — no new column needed; the
--      existing recipientUserId gate is the whole authorization.
--   2. An unlinked recipient cannot be authorized by recipientToken alone —
--      Ruling 12 already settled that a tracking token proves possession of
--      a link, never identity, which is exactly why claimAsRecipient needed
--      its own separate matching signal. The same reasoning applies here: a
--      SEPARATE, short-lived, single-use token is emailed to the shipment's
--      ON-FILE destinationEmail on request and exchanged for the code. It is
--      never derived from or guessable via recipientToken, so a leaked public
--      link can cause at most one email to the legitimate recipient's own
--      already-known inbox — never a direct code reveal.
--
-- deliveryCodeRevealRequestedAt is a per-SHIPMENT (not per-account, not
-- per-IP) cooldown marker, the same reasoning recipientClaimAttempts already
-- applies to a different probe: a rotating-IP caller must not be able to
-- email-bomb the recipient's own inbox by repeating the request.
--
-- WHAT DOES NOT CHANGE. recipientToken, the public trackPublic() allowlist,
-- and every existing sender-facing path to the code are untouched. No paid
-- SMS is introduced (owner ruling, explicit) — a recipient with no account
-- and no email on file has no automatic path yet; that is a named, reported
-- gap, not silently papered over.
--
-- ROLLBACK (verified against a scratch database, in order):
--   DROP INDEX "shipments_deliveryCodeRevealToken_key";
--   ALTER TABLE "shipments" DROP COLUMN "deliveryCodeRevealRequestedAt";
--   ALTER TABLE "shipments" DROP COLUMN "deliveryCodeRevealTokenExpiresAt";
--   ALTER TABLE "shipments" DROP COLUMN "deliveryCodeRevealToken";
--   -- AuditAction value stays: enum values are never removed.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_DELIVERY_CODE_EMAIL_REQUESTED';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "deliveryCodeRevealToken" TEXT;
ALTER TABLE "shipments" ADD COLUMN "deliveryCodeRevealTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "shipments" ADD COLUMN "deliveryCodeRevealRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_deliveryCodeRevealToken_key" ON "shipments"("deliveryCodeRevealToken");
