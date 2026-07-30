-- M10.1 cleanup: reservation-release support.
-- (Search-index DROPs from Prisma's auto-diff are intentionally omitted; the GIN
-- indexes on the Unsupported tsvector column are managed manually.)

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_RESERVATION_RELEASED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "reservationsReleasedAt" TIMESTAMP(3);
