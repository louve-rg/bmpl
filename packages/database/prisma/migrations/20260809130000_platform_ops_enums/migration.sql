-- Platform Operations (Phase 4 · M23) — enum changes, isolated from the table
-- migration so the new AuditAction value is never used in the same transaction it is
-- added (Postgres safety), matching the project's established enum-migration pattern.

-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_SETTING_UPDATED';
