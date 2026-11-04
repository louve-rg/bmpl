-- MDF-COURIER (owner directive, carrier onboarding). Four decisions settled
-- under delegated authority:
--
-- D1 (status lifecycle): shipping_provider_profiles today carries only
-- isActive, which has never distinguished "approved to operate" from
-- "not yet reviewed" or "rejected" — a self-registered carrier with no
-- further action was already as eligible as an admin-approved one wherever
-- a check only looked at isActive. Add a ShippingProviderStatus enum
-- (PENDING/APPROVED/REJECTED/SUSPENDED/REVOKED, mirroring
-- PassengerAffiliationStatus's shape) plus a NOT NULL `status` column
-- defaulting PENDING — every row always has a defined status, never an
-- ambiguous null third state alongside the five real ones. `isActive` is
-- left exactly as it is and not repurposed. Measured safe: the table has
-- zero rows in production (real and test sides both) — nothing to
-- backfill, nothing a default can get wrong for an existing row.
--
-- D1b (two sources of truth, deliberately not merged): approve/reject/
-- suspend/reactivate for the underlying SHIPPING_PROVIDER role already run
-- through the generic role-application/role-suspend mechanism, keyed on
-- UserRole.status, completely unrelated to this table. This new `status`
-- column does not replace that — it answers a different question
-- ("may this ORG be handed work", not "may this PERSON hold the role") and
-- the two are AND-gated at the one place operability is asserted
-- (provider-eligibility.ts), never derived from each other. See that
-- file's own comment for why an AND-gate was chosen over transitioning both
-- in one write.
--
-- D5 (the transition table, and the one security line): the full table is
-- on the ShippingProviderStatus enum's own doc comment in schema.prisma.
-- The property that matters for this migration: no state is reachable that
-- only a developer could leave (REJECTED has a carrier-initiated way back
-- to PENDING; REVOKED does not, by design, but is never literally
-- unreachable in code). statusReason is the carrier-visible explanation for
-- an adverse status, deliberately a plain nullable column rather than
-- anything keyed to the admin audit log, which a carrier cannot read.
--
-- D3 (mutual consent on an assignment): setLegOperator has always been a
-- unilateral admin write — the carrier had no accept/reject step, unlike
-- the passenger fleet affiliation lifecycle, which already requires mutual
-- consent for an operator/driver pairing. Add two nullable timestamps to
-- shipment_legs. Both null is "not applicable" for every leg that exists
-- before this migration runs (unassigned, or assigned before this feature
-- existed) — never "pending", so nothing already in flight starts
-- reading as awaiting a response it was never asked for.
--
-- Self-service scope (same card): a carrier claiming or releasing an
-- EXISTING, currently-unassigned LogisticsRoute needs its own audit action
-- (LOGISTICS_ROUTE_OPERATOR_CHANGED) — no schema change on LogisticsRoute
-- itself, operatedByProviderId already exists and is already nullable.
-- This never lets a carrier create a route or set its price/schedule;
-- those remain admin-entered business configuration.
--
-- All additive: one new enum; four new values on the existing AuditAction
-- enum; five new columns — one NOT NULL with a default (status, whose
-- default only matters for rows inserted after this migration — see
-- packages/database/CLAUDE.md §6 mechanism (4) for why a default on an
-- already-populated table needs care; this table has no existing rows, so
-- there is nothing to backfill and no reason to ever drop the default) and
-- four plain nullable columns (statusReason, statusChangedAt,
-- operatorAcceptedAt, operatorRejectedAt). No column is dropped, renamed,
-- narrowed or made NOT NULL on a populated table.

CREATE TYPE "ShippingProviderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED');

ALTER TABLE "shipping_provider_profiles"
  ADD COLUMN "status" "ShippingProviderStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3);

CREATE INDEX "shipping_provider_profiles_status_isTest_idx" ON "shipping_provider_profiles"("status", "isTest");

ALTER TABLE "shipment_legs"
  ADD COLUMN "operatorAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "operatorRejectedAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPPING_PROVIDER_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_LEG_OPERATOR_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_LEG_OPERATOR_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGISTICS_ROUTE_OPERATOR_CHANGED';
