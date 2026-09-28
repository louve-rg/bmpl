-- One audit action for making a first-mile dispatch deferral visible to
-- operations (BMPL-275), the observability half of BMPL-273's owner ruling
-- ("warn, and schedule into a future open window"). Written on the
-- TRANSITION into deferred only, never once per 20s sweeper tick -- see
-- ShipmentDispatchService.recordDeferralIfNew, which reads the leg's most
-- recent SHIPMENT_LEG_OFFERED/SHIPMENT_LEG_DISPATCH_DEFERRED row rather than
-- persisting a "deferred until T" flag anywhere. No leg column, no new
-- table: the row itself is the whole feature.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_LEG_DISPATCH_DEFERRED';
