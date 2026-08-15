-- M26.3 — simulation isolation.
--
-- Lets the REAL customer→vendor→dispatch→driver chain be rehearsed end to end
-- without a rehearsal ever touching a real customer, a real driver, or the
-- revenue figures.
--
-- Three flags, and the relationship between them is the whole design:
--
--   vendor_profiles.isTest   admin-set. A simulation storefront.
--   orders.isTest            DERIVED at checkout from the vendor being bought
--                            from — never read from the request body. That is
--                            what makes it unforgeable: a customer buying from a
--                            real store cannot produce a test order no matter
--                            what they post, and buying from a test store gets
--                            them nothing real.
--   driver_profiles.isTest   admin-set. A designated simulation driver.
--
-- Isolation is SYMMETRIC and enforced server-side in DriverService, which every
-- assignment path already funnels through: a test delivery is offered only to a
-- test driver, and a test driver is offered only test deliveries. Neither
-- direction relies on a label or on frontend filtering.
--
-- All three default to false, so every existing row keeps today's behaviour.
ALTER TABLE "orders"          ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vendor_profiles" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "driver_profiles" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Analytics excludes test orders on every aggregate, and cleanup finds them by
-- this flag rather than by interpreting order numbers.
CREATE INDEX "orders_isTest_idx" ON "orders"("isTest");

-- Designating a storefront or driver as a simulation account is a
-- security-relevant admin action — the vendor flag decides whether an order is a
-- test order, and the driver flag decides who may be offered one. Both get their
-- own audit action rather than borrowing an unrelated one.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VENDOR_TEST_MODE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DRIVER_TEST_MODE_CHANGED';
