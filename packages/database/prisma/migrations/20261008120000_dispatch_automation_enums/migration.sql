-- M26.3 — enum ADD VALUEs for automatic dispatch + vendor fulfilment.
-- Postgres requires ADD VALUE to be committed before use, so these are isolated
-- in their own migration (the same rule every other *_enums migration follows).

-- Vendor has started assembling the order. Additive: existing rows stay PENDING,
-- and nothing reads this value until the new fulfilment routes ship.
ALTER TYPE "VendorOrderStatus" ADD VALUE 'PREPARING';

ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_ORDER_PREPARING';
ALTER TYPE "AuditAction" ADD VALUE 'VENDOR_ORDER_READY_FOR_DISPATCH';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_AUTO_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_OFFER_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_DISPATCH_EXHAUSTED';
