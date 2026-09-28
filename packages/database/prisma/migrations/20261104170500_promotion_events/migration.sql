-- BMPL-332: promotion events keep their authoritative instant instead of
-- being collapsed into a daily counter at write time. BMPL-330 found that
-- the previous approach — track() incrementing promotion_metrics_daily and
-- discarding each event's real timestamp — had made the pre-BMPL-197
-- UTC-bucketed historical rows irreversibly un-reconstructable: an integer
-- sum cannot be un-mixed without the data that went into it, and that data
-- was never kept. The owner ruled the historical aggregate frozen (no
-- backfill, no estimate) and funded this instead: going forward, the
-- instant is kept.
--
-- Purely additive. promotion_metrics_daily is untouched — not a single
-- existing row, column or index changes. It is not being replaced: BMPL-332
-- measured (throwaway local database, never production) that the rollup's
-- read cost stays flat because its row count is bounded by
-- (promotions x days x placements), while an equivalent aggregate read
-- directly over event-level rows costs more, and grows, because that count
-- is bounded by the same three dimensions TIMES TRAFFIC. The rollup stays
-- as the permanent read path for existing reports; this table is additive
-- capacity, not a migration off the old shape. track() now writes both the
-- event row and the daily increment in one transaction (see
-- apps/api/src/marketing/promotion-discovery.service.ts) — one write
-- producing both facts, so the two can never independently drift apart.
--
-- IMPRESSION, VIEW, CLICK only — CONVERSION is deliberately absent from
-- this enum. BMPL-332 found no existing mechanism anywhere in this codebase
-- linking a completed Order back to a Promotion (unlike Coupon, which has a
-- live-written CouponUsage record with a real orderId). The owner has not
-- yet ruled on what authoritative activity should count as a promotion
-- conversion. Adding CONVERSION to this enum, and whatever linkage that
-- ruling requires, is a separate, later migration — not assumed here.

-- CreateEnum
CREATE TYPE "PromotionEventKind" AS ENUM ('IMPRESSION', 'VIEW', 'CLICK');

-- CreateTable
CREATE TABLE "promotion_events" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "kind" "PromotionEventKind" NOT NULL,
    "placement" "PromotionPlacementType",
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotion_events_promotionId_occurredAt_idx" ON "promotion_events"("promotionId", "occurredAt");

-- CreateIndex
CREATE INDEX "promotion_events_promotionId_kind_occurredAt_idx" ON "promotion_events"("promotionId", "kind", "occurredAt");

-- AddForeignKey
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
