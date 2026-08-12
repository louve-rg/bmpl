-- M26.3 client feedback — the driver's own ordering of their delivery queue.
--
-- A driver running several drops asked to be able to say which one they intend
-- to do next. This column holds that preference and NOTHING else: it is the
-- driver's note to themselves about sequence.
--
-- Deliberately NOT part of the delivery lifecycle:
--   * it never appears in a status transition, an assignment row, a timeline
--     event, or a settlement calculation;
--   * it cannot change who a delivery belongs to — the writer re-asserts
--     assignedDriverProfileId on every update;
--   * it cannot skip a step — pickup still requires the pickup PIN whatever
--     position the row sits at.
--
-- NULL is the normal state and means "no preference, use the recommendation".
-- No backfill: every existing delivery starts unordered, which is exactly the
-- behaviour drivers have today.
ALTER TABLE "order_deliveries" ADD COLUMN "driverQueuePosition" INTEGER;

-- The queue read is "my open deliveries, in my order". The existing
-- (assignedDriverProfileId, status) index already narrows to the driver; this
-- covers the sort so a driver with a long history does not pay for it.
CREATE INDEX "order_deliveries_assignedDriverProfileId_driverQueuePosition_idx"
  ON "order_deliveries"("assignedDriverProfileId", "driverQueuePosition");

-- The reorder is a driver-initiated write against delivery rows, so it is
-- audited like every other one. Added in the same migration as the column it
-- describes; a single ADD VALUE is safe on every supported PostgreSQL version.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DRIVER_QUEUE_REORDERED';
