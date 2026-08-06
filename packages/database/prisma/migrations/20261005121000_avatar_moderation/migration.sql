-- Profile pictures (M-avatars) — moderation state on the user record.
--
-- "avatarKey" (pre-existing) stays the LIVE, approved picture. A newer upload
-- lands in "avatarPendingKey" while it is being checked, so a rejected
-- replacement never wipes the photo the user already had approved.

ALTER TABLE "users" ADD COLUMN "avatarPendingKey"     TEXT;
ALTER TABLE "users" ADD COLUMN "avatarStatus"         "AvatarStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "users" ADD COLUMN "avatarRejectedReason" TEXT;
ALTER TABLE "users" ADD COLUMN "avatarFaceScore"      DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN "avatarSubmittedAt"    TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "avatarReviewedAt"     TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "avatarReviewedById"   TEXT;

-- Pictures that already exist predate moderation. They were uploaded under the
-- old rules (owner-only visibility) and are about to become visible to other
-- users, so they must go through the same check as everything else: mark them
-- PENDING rather than grandfathering them in as APPROVED.
UPDATE "users"
   SET "avatarStatus"      = 'PENDING',
       "avatarPendingKey"  = "avatarKey",
       "avatarKey"         = NULL,
       "avatarSubmittedAt" = CURRENT_TIMESTAMP
 WHERE "avatarKey" IS NOT NULL;

-- Drives the admin moderation queue (PENDING first, oldest submission first).
CREATE INDEX "users_avatarStatus_avatarSubmittedAt_idx" ON "users"("avatarStatus", "avatarSubmittedAt");

ALTER TABLE "users" ADD CONSTRAINT "users_avatarReviewedById_fkey"
  FOREIGN KEY ("avatarReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reviews gain a real relation to their author. "reviewerId" already held the
-- user id, but as a bare column with no constraint, so a review could not be
-- joined to the person who wrote it. Public reviews now show a name and face, so
-- the join has to exist.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
