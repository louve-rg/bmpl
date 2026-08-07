-- M26.3 Part 1 — profile-picture moderation applies to PROVIDERS only.
--
-- A customer's avatar asserts no identity, so reviewing it before publication
-- buys no safety and makes every new user wait. Only roles a customer physically
-- meets — a driver at the door, a passenger driver, an agent at a viewing — keep
-- review-before-publish. Mirrors AVATAR_MODERATED_ROLES in packages/shared.
--
-- The preceding avatar_moderation migration parked EVERY pre-existing picture in
-- PENDING. This releases the ones that never needed reviewing, so the queue that
-- ships to admins contains only genuine identity claims rather than a backlog of
-- shoppers' selfies.

UPDATE "users" u
   SET "avatarStatus"     = 'APPROVED',
       "avatarKey"        = u."avatarPendingKey",
       "avatarPendingKey" = NULL,
       "avatarReviewedAt" = CURRENT_TIMESTAMP
 WHERE u."avatarStatus" = 'PENDING'
   AND u."avatarPendingKey" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM "user_roles" r
      WHERE r."userId"  = u."id"
        AND r."status"  = 'APPROVED'
        AND r."roleCode" IN (
          'DELIVERY_DRIVER',
          'PASSENGER_DRIVER',
          'SHIPPING_PROVIDER',
          'PASSENGER_PROVIDER',
          'REAL_ESTATE_AGENT',
          'EMPLOYER'
        )
   );

-- Same reasoning for anyone auto-rejected by the face check while the policy
-- still applied to everyone: a customer should not carry a REJECTED avatar state
-- for a photo that no longer needs to pass a check. Reset them to a clean slate
-- so the UI stops showing a rejection notice they cannot act on.
UPDATE "users" u
   SET "avatarStatus"         = 'NONE',
       "avatarRejectedReason" = NULL,
       "avatarFaceScore"      = NULL
 WHERE u."avatarStatus" = 'REJECTED'
   AND u."avatarKey" IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM "user_roles" r
      WHERE r."userId"  = u."id"
        AND r."status"  = 'APPROVED'
        AND r."roleCode" IN (
          'DELIVERY_DRIVER',
          'PASSENGER_DRIVER',
          'SHIPPING_PROVIDER',
          'PASSENGER_PROVIDER',
          'REAL_ESTATE_AGENT',
          'EMPLOYER'
        )
   );
