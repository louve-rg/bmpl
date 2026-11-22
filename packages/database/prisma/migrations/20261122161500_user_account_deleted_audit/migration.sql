-- MDF-924: self-service account deletion gets its own AuditAction, kept
-- separate from USER_SUSPENDED/USER_RESTORED since this one is
-- self-initiated, anonymizes the row, and is permanent — not an admin
-- action and not reversible the way a suspension is. Checked the full
-- AuditAction enum first; nothing else already covers this.
--
-- ADD ONLY: nothing in this migration references the new value — Postgres
-- refuses a transaction that both adds an enum member and uses it (see
-- packages/database/CLAUDE.md §2). The deletion code that writes this
-- value ships in the same PR but runs only after this migration has
-- committed. Kept as its own file, separate from the companion
-- `users.deletedAt` column migration, matching this repo's existing
-- practice of not mixing an enum addition with a table/column change in
-- one file.
--
-- ROLLBACK: cannot remove an enum value Postgres has ever stored a row
-- against (see packages/database/CLAUDE.md §2) — not reversible by a
-- migration, same as every other AuditAction addition.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_ACCOUNT_DELETED';
