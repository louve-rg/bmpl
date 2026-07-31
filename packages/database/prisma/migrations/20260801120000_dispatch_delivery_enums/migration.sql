-- Dispatch & Delivery Execution (Phase 4 · M15) — enum value additions.
-- These ALTER TYPE ... ADD VALUE statements are isolated in their own migration:
-- Postgres forbids USING a newly added enum value in the same transaction that
-- adds it, so the columns/data that reference them land in the next migration.

-- AlterEnum: DeliveryStatus lifecycle (M13 had PENDING_ASSIGNMENT only)
ALTER TYPE "DeliveryStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DRIVER_ACCEPTED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DRIVER_DECLINED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'PICKUP_CONFIRMED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "DeliveryStatus" ADD VALUE 'ARRIVING';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'CANCELLED';

-- AlterEnum: InventoryChangeReason (reservation → deduction at pickup)
ALTER TYPE "InventoryChangeReason" ADD VALUE 'FULFILLED';

-- AlterEnum: AuditAction (dispatch lifecycle audit records)
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_ASSIGNMENT_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_PICKUP_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_IN_TRANSIT';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_ARRIVING';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_POD_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_PICKUP_PIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_DELIVERY_PIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'INVENTORY_FULFILLED';
