-- Notifications & Event System (Phase 4 · M16).
-- Normalize the single per-user `notifications` table into a Notification EVENT
-- (fan-out capable) + NotificationRecipient (per-user read/dismiss state) +
-- NotificationPreference. Existing rows are migrated into one recipient each
-- BEFORE the moved columns are dropped (no data loss).

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ORDER', 'PAYMENT', 'DELIVERY', 'DRIVER', 'VENDOR', 'ACCOUNT', 'ROLE_APPLICATION', 'ADMIN_ALERT', 'SECURITY', 'SYSTEM');

-- AlterTable: add the event columns (keep userId/readAt/channel/sentAt for backfill)
ALTER TABLE "notifications" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN "event" TEXT;

-- Backfill category from the legacy type
UPDATE "notifications" SET "category" = (CASE "type"
  WHEN 'MARKETPLACE' THEN 'ORDER'
  WHEN 'ACCOUNT' THEN 'ACCOUNT'
  WHEN 'ROLE_APPLICATION' THEN 'ROLE_APPLICATION'
  WHEN 'ROLE_STATUS' THEN 'ROLE_APPLICATION'
  WHEN 'SECURITY' THEN 'SECURITY'
  ELSE 'SYSTEM' END)::"NotificationCategory";

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "readAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- Backfill: one recipient per existing notification (preserves read state + channel).
-- gen_random_uuid() is built in on PostgreSQL 13+; the id column is opaque TEXT.
INSERT INTO "notification_recipients" ("id", "notificationId", "userId", "channel", "readAt", "createdAt")
  SELECT gen_random_uuid()::text, "id", "userId", "channel", "readAt", "createdAt" FROM "notifications";

-- Now drop the columns that moved to the recipient table
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";
DROP INDEX "notifications_userId_readAt_idx";
ALTER TABLE "notifications" DROP COLUMN "channel",
DROP COLUMN "readAt",
DROP COLUMN "sentAt",
DROP COLUMN "userId";

-- CreateIndex
CREATE INDEX "notification_recipients_userId_readAt_idx" ON "notification_recipients"("userId", "readAt");
CREATE INDEX "notification_recipients_userId_deletedAt_idx" ON "notification_recipients"("userId", "deletedAt");
CREATE INDEX "notification_recipients_notificationId_idx" ON "notification_recipients"("notificationId");
CREATE UNIQUE INDEX "notification_recipients_notificationId_userId_key" ON "notification_recipients"("notificationId", "userId");
CREATE INDEX "notification_preferences_userId_idx" ON "notification_preferences"("userId");
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");
CREATE INDEX "notifications_category_createdAt_idx" ON "notifications"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
