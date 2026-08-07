-- M26.3 — automatic dispatch state on the delivery row.
--
-- The engine offers a delivery to one driver at a time and rolls the offer
-- forward when it lapses, rather than broadcasting to everyone. Three columns
-- carry that: when the current offer dies, how many drivers have already seen
-- it, and whether the pool is genuinely exhausted (the one case a human is
-- still needed).
--
-- readyForDispatchAt is set by the vendor marking the order ready. Dispatch
-- never offers a delivery for goods that are not packed yet — otherwise a driver
-- is sent to stand at a counter waiting.

ALTER TABLE "order_deliveries" ADD COLUMN "offerExpiresAt"      TIMESTAMP(3);
ALTER TABLE "order_deliveries" ADD COLUMN "offerCount"          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_deliveries" ADD COLUMN "dispatchExhaustedAt" TIMESTAMP(3);
ALTER TABLE "order_deliveries" ADD COLUMN "readyForDispatchAt"  TIMESTAMP(3);

-- The sweeper runs on an interval and asks one question: which offers lapsed?
-- Without this that is a full table scan of every delivery ever made, per tick.
CREATE INDEX "order_deliveries_offerExpiresAt_idx" ON "order_deliveries"("offerExpiresAt");

-- Finding dispatchable work: readied by the vendor, not yet held by a driver.
CREATE INDEX "order_deliveries_status_readyForDispatchAt_idx"
  ON "order_deliveries"("status", "readyForDispatchAt");

-- Deliveries already in flight predate this column. Backfilling them as ready
-- keeps them dispatchable rather than stranding live orders behind a flag that
-- did not exist when they were created. Anything already assigned is unaffected
-- by the filter, so this only rescues the PENDING_ASSIGNMENT backlog.
UPDATE "order_deliveries"
   SET "readyForDispatchAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
 WHERE "readyForDispatchAt" IS NULL
   AND "status" = 'PENDING_ASSIGNMENT';

-- Admin-configurable dispatch tuning, on the existing singleton settings row.
-- Defaults mirror the constants in @bmpl/shared/dispatch-ranking so an untouched
-- install behaves exactly as the tested defaults describe, and an operator can
-- retune timeout/retries/weighting without a deploy.
ALTER TABLE "platform_settings" ADD COLUMN "dispatchAutomatic"              BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchOfferTimeoutSeconds"    INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchMaxOffers"              INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchMaxConcurrentPerDriver" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchWeightWorkload"         INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchWeightFairness"         INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchWeightRating"           INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchWeightLocality"         INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "platform_settings" ADD COLUMN "dispatchWeightExperience"       INTEGER NOT NULL DEFAULT 5;
