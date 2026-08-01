-- Platform Operations announcement / maintenance banner (Phase 4 · M23).
-- Single admin-managed settings row; maintenanceMode is display-only (never gates the API).

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "announcementActive" BOOLEAN NOT NULL DEFAULT false,
    "announcementLevel" "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
    "announcementMessage" TEXT,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
