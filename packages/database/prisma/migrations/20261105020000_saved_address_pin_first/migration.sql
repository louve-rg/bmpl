-- A saved address is written down OR pinned -- either alone is complete
-- (MDF-485). "addressLine1" was NOT NULL, the same defect "order_addresses"
-- had before 20261102090000_pin_only_delivery_address: a customer who had
-- already dropped a pin on their own house still had to invent a street
-- before the address book would save it. Follow that same precedent rather
-- than inventing a second pattern.
--
-- Two new nullable columns, for the owner's Belize requirements:
--   "landmark"       - a wayfinding reference ("behind the blue gate"),
--                      distinct from "instructions" (a delivery note). The
--                      owner lists them separately; cramming one into the
--                      other would lose that distinction.
--   "pinConfirmedAt" - set only when a customer has manually placed and
--                      confirmed a map pin, never taken from a request body
--                      directly. Null means there is no pin, or its
--                      provenance is unconfirmed. This makes the owner's
--                      invariant checkable: a manually confirmed pin must
--                      never be silently overwritten by an approximate
--                      geocoded guess.
--
-- "city" and "district" stay NOT NULL -- they price a delivery and match a
-- driver, and no pin is allowed to imply them. Only the street line and the
-- two new columns are optional.
--
-- Nothing existing changes. Every row written so far has a street line, and
-- "is this address locatable" (street OR pin, never neither) is enforced in
-- the application schema (savedAddressSchema / AddressesService), where it
-- can explain itself to a customer -- not a CHECK constraint, which can only
-- say "violates constraint".

ALTER TABLE "saved_addresses" ALTER COLUMN "addressLine1" DROP NOT NULL;
ALTER TABLE "saved_addresses" ADD COLUMN "landmark" TEXT;
ALTER TABLE "saved_addresses" ADD COLUMN "pinConfirmedAt" TIMESTAMP(3);
