-- Simulation-only transport infrastructure, so the multimodal engine can be
-- proven end to end without inventing real terminals, lanes or commercial rates.
-- A TEST hub or route is never offered to a real customer.
ALTER TABLE "logistics_hubs" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "logistics_routes" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "logistics_hubs_isTest_isActive_idx" ON "logistics_hubs"("isTest", "isActive");
CREATE INDEX "logistics_routes_isTest_isActive_idx" ON "logistics_routes"("isTest", "isActive");

-- A simulation local-courier rate, kept apart from the production rate so a
-- price set for testing cannot become the real nationwide price.
ALTER TABLE "platform_settings" ADD COLUMN "localCourierFeeTestMinor" BIGINT NOT NULL DEFAULT 0;
