-- WALLET ACTIVATION
--
-- Two flags, both additive, both defaulting to the safe value.
--
-- users.isTest marks a simulation account. It is ADMIN-SET ONLY and is what
-- gates TEST wallet funding: a customer cannot set it on themselves, so they
-- cannot mint themselves money. Mirrors vendor_profiles.isTest and
-- driver_profiles.isTest, which already work exactly this way.
--
-- wallet_transactions.isTest marks rehearsal money. It is inherited from the
-- account owner at posting time and never accepted from a caller. Real
-- financial reporting and settlement filter it out; the ledger still balances
-- with it in place, because it is genuine double-entry bookkeeping over money
-- that simply does not represent anything.
ALTER TABLE "users" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "wallet_transactions" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "wallet_transactions_isTest_createdAt_idx" ON "wallet_transactions"("isTest", "createdAt");

-- Every privileged money action is audited, so funding needs its own actions.
ALTER TYPE "AuditAction" ADD VALUE 'WALLET_TOPUP_POSTED';
ALTER TYPE "AuditAction" ADD VALUE 'WALLET_TEST_FUNDING_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'USER_TEST_FLAG_CHANGED';
