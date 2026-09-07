-- The wallet lock/unlock fraud control gets its audit vocabulary.
--
-- What was wrong: WalletAccountStatus has carried LOCKED since the wallet
-- shipped, and the spend/top-up paths already refuse a non-ACTIVE wallet —
-- but no product path could ever SET the status, so the control existed
-- only as an enforcement with no lever. The owner has now approved the
-- lever: an administrator locks or unlocks a wallet, authorized and
-- permanently recorded.
--
-- This migration is ONLY the audit value for that record. One action covers
-- both directions — who, which wallet, which way, and why travel in the
-- audit row's previous/new values, following the existing *_CHANGED
-- precedent — because a lock and its unlock are one story a fraud review
-- reads together.
--
-- What does NOT change: no wallet table is touched, no status value is
-- added (LOCKED already exists), no balance semantics move. Additive only:
-- one appended enum value, idempotent.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WALLET_ACCOUNT_STATUS_CHANGED';
