-- A delivery address is written down OR pinned. Either one alone is complete.
--
-- This column was NOT NULL, which is what made "drop a pin" pointless at
-- checkout: a customer who had shown us their exact doorstep still had to invent
-- a street address before the order would save. In Belize the pin is often the
-- BETTER of the two — plenty of real addresses ("behind the old bridge") are
-- useless to navigate by — so the schema was rejecting the good answer.
--
-- The TOWN stays NOT NULL. It is not location detail: it prices the delivery and
-- matches the driver, and no pin is allowed to imply it, so every address still
-- carries one. Only the street line is genuinely optional.
--
-- Nothing existing changes. Every row written so far has a street line, and the
-- rule that at least one of (street) or (pin) is present is enforced in the
-- application schema, where it can explain itself to a customer. A CHECK
-- constraint here would say only "violates constraint".

ALTER TABLE "order_addresses" ALTER COLUMN "addressLine1" DROP NOT NULL;
