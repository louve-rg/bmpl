-- The booking form asks for an email, a company and a second address line.
-- Without somewhere to put them they were collected and discarded, which is
-- worse than not asking.
ALTER TABLE "shipments" ADD COLUMN "originEmail" TEXT;
ALTER TABLE "shipments" ADD COLUMN "originCompany" TEXT;
ALTER TABLE "shipments" ADD COLUMN "originAddress2" TEXT;
ALTER TABLE "shipments" ADD COLUMN "destinationEmail" TEXT;
ALTER TABLE "shipments" ADD COLUMN "destinationCompany" TEXT;
ALTER TABLE "shipments" ADD COLUMN "destinationAddress2" TEXT;
