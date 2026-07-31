-- M14: audit actions for driver management.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "AuditAction" ADD VALUE 'DRIVER_PROFILE_UPSERTED';
ALTER TYPE "AuditAction" ADD VALUE 'DRIVER_AVAILABILITY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'DRIVER_VEHICLE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'DRIVER_VEHICLE_REJECTED';
