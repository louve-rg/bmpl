-- MDF-951: ACCT-SESSIONS' "sign out everywhere else"
-- (SessionService.revokeOthersForUser) had no audit trail at all. God's
-- own carded reasoning: it is a BULK security action — every OTHER live
-- session on the account ends in one call — which is a different shape
-- from LOGOUT (one device, itself, unaudited) or revoking a single named
-- session by id (one device, by id). Following the LOGOUT precedent for
-- this one specifically would have been the wrong fit, not the safe
-- default. Checked the full AuditAction enum first; nothing else already
-- covers this.
--
-- ADD ONLY: nothing in this migration references the new value — Postgres
-- refuses a transaction that both adds an enum member and uses it (see
-- packages/database/CLAUDE.md §2). The code that writes this value ships
-- in the same PR but runs only after this migration has committed.
--
-- ROLLBACK: cannot remove an enum value Postgres has ever stored a row
-- against (see packages/database/CLAUDE.md §2) — not reversible by a
-- migration, same as every other AuditAction addition.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSIONS_REVOKED_OTHERS';
