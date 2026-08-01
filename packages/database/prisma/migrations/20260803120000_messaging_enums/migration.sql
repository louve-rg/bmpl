-- Messaging & Order Communication (Phase 4 · M17) — enum value additions.
-- Isolated: Postgres forbids using a newly added enum value in the same
-- transaction that adds it.
ALTER TYPE "AuditAction" ADD VALUE 'CONVERSATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONVERSATION_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'CONVERSATION_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'MESSAGE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'MESSAGE_ATTACHMENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'SUPPORT_JOINED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERNAL_NOTE_ADDED';
ALTER TYPE "NotificationCategory" ADD VALUE 'MESSAGE';
