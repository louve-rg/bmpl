-- Simulation money a person issued to their own wallet during UAT, kept
-- distinct in the audit trail from an administrator granting it to somebody.
--
-- Additive only: a new enum value. Nothing is renamed or removed, so an older
-- API release keeps working against this schema.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WALLET_SELF_SERVICE_TEST_FUNDING_GRANTED';
