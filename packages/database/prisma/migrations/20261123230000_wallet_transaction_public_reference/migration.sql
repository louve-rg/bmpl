-- MDF-1148, finding A. Stanley's acceptance walk on main (4726dee3) found that
-- a transfer's receipt and the generic transaction-detail shape both
-- serialised `wallet_transactions.reference` raw to the client. That column
-- is `transfer:<senderUserId>:<idempotencyKey>` for a P2P transfer — so a
-- recipient reading their own receipt was handed the sender's internal user
-- id AND the sender's idempotency key.
--
-- `reference` cannot be changed: it is the idempotency write-guard
-- (`@@unique([reference])`, unchanged by this migration) that makes a
-- duplicate post collide with P2002, and nothing about that mechanism is
-- the actual defect. The defect is that the server had no SEPARATE value
-- safe to hand to a client, so it handed out the guard itself.
--
-- This adds exactly that separate value: a short, opaque, human-quotable
-- reference, generated once per transaction (WalletService.postTransaction)
-- in the same `BML-<alphabet>` shape already used for shipment tracking
-- codes and passenger ticket/booking codes elsewhere in this repo, reusing
-- that convention rather than inventing a second one.
--
-- Nullable: a transaction posted before this column existed has none, and
-- none is backfilled — there is nothing safe to derive it from after the
-- fact, and leaving it null is strictly safer than inventing a value. Every
-- transaction posted from this migration onward gets one.
ALTER TABLE "wallet_transactions" ADD COLUMN "publicReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_publicReference_key" ON "wallet_transactions"("publicReference");
