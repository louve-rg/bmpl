-- TERM-6: closes slice 1's own self-reported gap. Three admin-driven writes
-- that were missing on terminal_company_profiles/_members/_member_locations:
--  1. Editing a company's own businessName/contactEmail/contactPhone — until
--     now a mistyped name was permanent; there was no update endpoint at all.
--  2. Reactivating an ended member directly. The working path was already
--     end-membership-then-a-fresh-invite (TerminalService.acceptInvite's own
--     existing-member branch flips status/endedAt back on accept) — this adds
--     a second door that must mean the exact same thing, not a new status or
--     a new effect on memberRole/location grants.
--  3. Granting or revoking ONE location for an already-ACTIVE member without
--     ending and re-inviting them.
--
-- No new table, no new column, no new enum type. Every write above uses
-- columns terminal_company_profiles/_members/_member_locations already had
-- (20261109040000_terminal_companies) — only AuditAction gains four values,
-- added idempotently below, for four actions that previously had none to
-- record under.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_MEMBER_REACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_MEMBER_LOCATION_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_MEMBER_LOCATION_REVOKED';
