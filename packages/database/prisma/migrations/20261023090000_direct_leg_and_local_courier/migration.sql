-- A door-to-door journey inside one district has no terminal in it. DIRECT is
-- the single courier leg that describes it.
ALTER TYPE "LegKind" ADD VALUE 'DIRECT';

-- What BML charges for that run. Hub courier fees price terminal-to-address
-- work and cannot describe address-to-address work.
ALTER TABLE "platform_settings" ADD COLUMN "localCourierFeeMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "platform_settings" ADD COLUMN "localCourierMinutes" INTEGER NOT NULL DEFAULT 0;
