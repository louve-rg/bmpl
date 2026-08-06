-- Profile pictures (M-avatars) — new enum + AuditAction ADD VALUEs.
-- Postgres requires ADD VALUE to be committed before the value can be used, so
-- these are isolated in their own migration (same rule the other *_enums use).

CREATE TYPE "AvatarStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_AUTO_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_AUTO_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'AVATAR_REMOVED';
