-- Passenger fleet affiliation gets a management workflow (BMPL-39).
--
-- What was wrong: PassengerDriverProfile.providerProfileId — the link that
-- decides whose departures a driver may staff — existed in the data with NO
-- product path that could ever set it. A real operator therefore could not
-- staff a single departure. Found and reported during S3; the owner has now
-- ruled on the consent model.
--
-- The rule, verbatim from the owner: MUTUAL CONSENT. Neither party may
-- unilaterally create an active affiliation. An operator may INVITE a driver,
-- who must accept; a driver may REQUEST to join a fleet, which the operator
-- must approve.
--
-- Why a separate agreement table rather than writing the pointer directly:
-- a pointer cannot hold a half-consented state, an initiator, a refusal or a
-- history — and every one of those is required. The shape is
-- PropertyListingAssignment's, the existing two-party consent precedent:
-- PENDING rows are unanswered asks; ONLY the counterparty's consent makes a
-- row ACCEPTED, and that acceptance sets the operational pointer in the same
-- transaction. Termination ENDs a row rather than deleting it, preserving the
-- audit trail; a new agreement is a new row.
--
-- Rejected alternatives: reusing RoleApplication (an affiliation is between
-- two account holders, not between a person and platform moderation); a
-- CHECK constraint tying the pointer to an ACCEPTED row (the rule needs to
-- explain itself in the validation/service layer, per house convention).
--
-- What does NOT change: no existing table or row is touched; the pointer
-- column keeps its meaning and its SetNull behaviour (a fleet dissolving
-- leaves its drivers independent); no commercial policy of any kind is
-- introduced — the row carries no fee, split or employment term.
--
-- Additive only: two new enums, one new empty table, one appended audit
-- value. Idempotent where the syntax allows it.

CREATE TYPE "PassengerAffiliationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'ENDED');

CREATE TYPE "PassengerAffiliationParty" AS ENUM ('DRIVER', 'PROVIDER');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_AFFILIATION_CHANGED';

CREATE TABLE "passenger_fleet_affiliations" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "providerProfileId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "initiatedBy" "PassengerAffiliationParty" NOT NULL,
    "status" "PassengerAffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedBy" "PassengerAffiliationParty",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_fleet_affiliations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "passenger_fleet_affiliations_providerProfileId_status_idx" ON "passenger_fleet_affiliations"("providerProfileId", "status");

CREATE INDEX "passenger_fleet_affiliations_driverProfileId_status_idx" ON "passenger_fleet_affiliations"("driverProfileId", "status");

ALTER TABLE "passenger_fleet_affiliations" ADD CONSTRAINT "passenger_fleet_affiliations_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "passenger_provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passenger_fleet_affiliations" ADD CONSTRAINT "passenger_fleet_affiliations_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "passenger_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
