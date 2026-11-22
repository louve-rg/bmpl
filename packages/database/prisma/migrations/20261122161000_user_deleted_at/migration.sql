-- MDF-924: self-service account deletion needs a structural way to tell a
-- real deletion apart from `status: DEACTIVATED` alone — the owner's own
-- hard requirement is that deactivation is NOT deletion, and today nothing
-- on this table lets a later reader distinguish the two (DEACTIVATED is an
-- existing UserStatus value that no code path has ever actually written).
--
-- `deletedAt` is nullable and additive: a pure loosening, no backfill, no
-- existing row affected. It is set together with `status: DEACTIVATED` by
-- AuthService/UsersService's deletion path, and only there — it marks that
-- THIS particular closed account was reached by self-service deletion
-- (personal data anonymized, every session revoked), as opposed to some
-- other future reason a row might end up DEACTIVATED.
--
-- The `users` row itself is never deleted and never will be by this path:
-- every other table's foreign key into it (orders, shipments, audit log,
-- wallet accounts, ...) stays valid. That is the entire reason this is an
-- anonymize-in-place column, not a DELETE.

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
