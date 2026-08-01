-- Pickup fulfilment (M18.1) — VendorOrder collection fields (additive).
ALTER TABLE "vendor_orders"
  ADD COLUMN "readyForPickupAt" TIMESTAMP(3),
  ADD COLUMN "pickedUpAt" TIMESTAMP(3),
  ADD COLUMN "pickupPin" TEXT,
  ADD COLUMN "pickupPinAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inventoryFinalizedAt" TIMESTAMP(3);
