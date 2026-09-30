-- BMPL-183/343: audit vocabulary for the two possible outcomes of attempting
-- a return-to-sender (see 20261104210000 for the data-model half).
--
-- SHIPMENT_RETURN_INITIATED: a return was priced, confirmed and booked as a
-- new transport charge -- newValue carries both shipment ids and the
-- return's own price.
--
-- SHIPMENT_RETURN_PENDING_MANUAL: the mirror image of the owner's own fence
-- -- no valid configured price could be calculated for the reversed route,
-- so the return stays PENDING or MANUAL rather than guessing one. A
-- supported, tested outcome, not an error swallowed silently. Nothing is
-- charged and no shipment is created when this is recorded.
--
-- Additive and idempotent; no existing enum value is touched, changed or
-- removed. Kept in its own migration, separate from the structural change
-- (returnOfShipmentId) this feature also needs, matching this floor's own
-- convention of one migration per enum extension.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_RETURN_INITIATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_RETURN_PENDING_MANUAL';
