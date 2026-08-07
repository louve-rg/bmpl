-- M26.3 Part 1 — a customer's picture is cosmetic and NOT public.
--
-- Customer avatars are shown inside their own account only. Provider avatars
-- (driver, passenger driver, agent, employer) are identity verification and ARE
-- shown to the customers who meet them. Both were reaching the same public
-- endpoint, so a shopper's photo was appearing on public product reviews.
--
-- The distinction is recorded per-picture rather than derived from the user's
-- roles at read time. Roles change; a photo approved under identity review stays
-- the verified one, and a cosmetic photo can never become public because its
-- owner later gains a role.

ALTER TABLE "users" ADD COLUMN "avatarModerated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: an existing APPROVED picture is treated as verified ONLY if its owner
-- currently holds a provider role. Everyone else's becomes cosmetic, which is the
-- safe direction — it un-publishes photos rather than publishing more of them.
UPDATE "users" u
   SET "avatarModerated" = true
 WHERE u."avatarStatus" = 'APPROVED'
   AND EXISTS (
     SELECT 1
       FROM "user_roles" r
      WHERE r."userId"   = u."id"
        AND r."status"   = 'APPROVED'
        AND r."roleCode" IN (
          'DELIVERY_DRIVER',
          'PASSENGER_DRIVER',
          'SHIPPING_PROVIDER',
          'PASSENGER_PROVIDER',
          'REAL_ESTATE_AGENT',
          'EMPLOYER'
        )
   );
