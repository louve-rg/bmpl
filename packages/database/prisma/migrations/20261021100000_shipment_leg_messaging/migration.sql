-- MESSAGING ON A COURIER LEG
--
-- Reuses the existing M17 conversation machinery rather than building a second
-- one. The context is the LEG, not the shipment: a first-mile driver has no
-- business in a conversation with the recipient at the far end of the country,
-- and a last-mile driver has none with the sender. Scoping to the leg makes that
-- boundary structural instead of a rule somebody has to remember.
--
-- Additive: one enum value.
ALTER TYPE "ConversationContext" ADD VALUE 'SHIPMENT_LEG';
