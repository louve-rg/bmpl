-- Deliveries orphaned by a cancelled order.
--
-- Cancelling an order (payment authorization failure) updated the order and its
-- vendor orders but never the attached delivery, so every failed-payment order
-- left a delivery sitting in PENDING_ASSIGNMENT indefinitely — an order nobody
-- would ever fulfil, still presenting itself as work awaiting a driver.
--
-- They were invisible until automatic dispatch arrived and started reading that
-- queue: during M26.3 verification one of them was offered to a driver. The code
-- path is fixed in PaymentsService; this reconciles the rows it already left.
--
-- Deliberately conservative:
--   * only deliveries whose VENDOR ORDER is CANCELLED are touched — the order
--     itself being cancelled is not enough, since a multi-vendor order can be
--     partially cancelled;
--   * PICKUP_CONFIRMED and later are left alone. Once a driver has physically
--     collected goods, rewriting the row would misstate what happened, and those
--     cases need a human rather than a bulk UPDATE.

UPDATE "order_deliveries" d
   SET "status"             = 'CANCELLED',
       "cancelledAt"        = COALESCE(d."cancelledAt", CURRENT_TIMESTAMP),
       "cancellationReason" = COALESCE(d."cancellationReason", 'Order cancelled — reconciled'),
       "readyForDispatchAt" = NULL,
       "offerExpiresAt"     = NULL,
       "assignedDriverProfileId" = NULL,
       "assignedVehicleId"  = NULL
 WHERE d."status" IN ('PENDING_ASSIGNMENT', 'ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED')
   AND EXISTS (
     SELECT 1
       FROM "vendor_orders" vo
      WHERE vo."id" = d."vendorOrderId"
        AND vo."status" = 'CANCELLED'
   );
