-- Passenger S3: the booking and movement lifecycle needs its audit vocabulary.
-- Confirmation is the moment seats are actually held against capacity;
-- cancellation carries party attribution the product owner will one day need
-- for a cancellation policy; assignment records which human put which driver
-- on which departure (manual-only, by design); completion is when a booking
-- becomes history. Each is a privileged or dispute-relevant action and none
-- had a code. Booking CREATION is deliberately not audited - the rider's own
-- row, created by them about themselves, is its own record, the same
-- reasoning as S1 vehicle registration.
--
-- Additive only: four enum values, appended, idempotent. No table is touched
-- and no existing row changes.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_BOOKING_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_BOOKING_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_TRIP_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_TRIP_COMPLETED';
