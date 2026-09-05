-- The one-live-ask affiliation rule becomes a database fact, not a service
-- promise.
--
-- What was wrong: "one live ask per (operator, driver) pair, in either
-- direction" was enforced by a check-then-create in the affiliation service.
-- Two concurrent asks could both pass the check and create twin PENDING
-- rows — exactly the two-half-asks state the mutual-consent ruling forbids.
-- No consent breach follows (activation is separately guarded), but an
-- invariant the database cannot represent is worth less than one it can.
--
-- The fix: a partial unique index over the pair, scoped to PENDING rows
-- only. Settled rows (ACCEPTED / DECLINED / WITHDRAWN / ENDED) are history
-- and may repeat freely; only the unanswered ask is unique. The service
-- keeps its friendly pre-check for the ordinary case and converts this
-- index's violation (P2002) into the same plain-words refusal for the race.
--
-- HAND-WRITTEN INDEX — PRISMA CAVEAT, read before touching this schema
-- again: Prisma's schema language cannot express a partial index, so this
-- index exists ONLY here and is deliberately absent from schema.prisma
-- (documented in the model's comment). A future `prisma migrate dev` diff
-- may propose DROPPING it as "drift". Never accept that drop — this
-- repository has already been bitten once by a generator wanting to remove
-- what it did not understand.
--
-- Additive only: one index on a young table. No data changes, nothing is
-- rewritten, and no existing rows can violate it (twin PENDINGs could only
-- arise from a race the service window made vanishingly small).

CREATE UNIQUE INDEX "passenger_fleet_affiliations_one_pending_per_pair"
  ON "passenger_fleet_affiliations"("providerProfileId", "driverProfileId")
  WHERE "status" = 'PENDING';
