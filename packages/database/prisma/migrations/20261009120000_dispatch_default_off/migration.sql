-- M26.3 — automatic dispatch ships DISABLED.
--
-- The engine and the vendor fulfilment API land before the vendor UI that drives
-- them. Until a vendor can actually mark an order ready in the browser, the
-- workflow is only half wired, and a half-wired workflow must not start offering
-- real customers' orders to drivers.
--
-- This is a rollout gate on the EXISTING platform_settings singleton, not a new
-- flag system. Turning the feature on is a one-row UPDATE once the whole path is
-- production-verified — and turning it back off is the same, which is what makes
-- it a safe thing to ship.
--
-- Written to be correct whichever order the preceding migrations applied in:
-- the column default is changed AND existing rows are flipped.

ALTER TABLE "platform_settings" ALTER COLUMN "dispatchAutomatic" SET DEFAULT false;

UPDATE "platform_settings" SET "dispatchAutomatic" = false;

-- When the vendor started assembling the order, for the customer timeline.
-- A real column rather than reusing updatedAt, which moves on any write and
-- would misdate the timeline as soon as anything else touched the row.
ALTER TABLE "vendor_orders" ADD COLUMN "preparingAt" TIMESTAMP(3);
