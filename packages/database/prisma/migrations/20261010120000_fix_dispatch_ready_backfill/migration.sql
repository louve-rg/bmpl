-- M26.3 — undo an over-broad backfill that made unreadied deliveries dispatchable.
--
-- 20261008121000_dispatch_automation set readyForDispatchAt on EVERY delivery
-- sitting in PENDING_ASSIGNMENT, reasoning that they should not be stranded
-- behind a column that did not exist when they were created.
--
-- That was wrong. PENDING_ASSIGNMENT is not a backlog of packed orders waiting
-- for a driver — it is every delivery ever created and never assigned, including
-- orders whose vendor never started preparing them. Marking them dispatchable
-- meant that the moment automatic dispatch was switched on, the sweeper offered
-- real, unprepared orders to whichever driver happened to be online. That is
-- exactly what happened during production verification: a live order was offered
-- to an internal test driver seconds after the flag was enabled.
--
-- readyForDispatchAt means one thing: THE VENDOR SAID THE GOODS ARE PACKED. It
-- may only be set by VendorFulfilmentService.markReady. This clears it wherever
-- the vendor order does not actually say so.
--
-- Safe to re-run, and safe for in-flight work: deliveries whose vendor order IS
-- READY_FOR_PICKUP (or already collected) keep their timestamp and stay
-- dispatchable.

UPDATE "order_deliveries" d
   SET "readyForDispatchAt" = NULL
 WHERE d."readyForDispatchAt" IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM "vendor_orders" vo
      WHERE vo."id" = d."vendorOrderId"
        AND vo."status" NOT IN ('READY_FOR_PICKUP', 'PICKED_UP')
   );
