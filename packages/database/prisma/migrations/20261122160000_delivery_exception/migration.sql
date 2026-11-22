-- MDF-927, owner directive 2026-11-22: the shipment lifecycle's unhappy
-- ends (a failed delivery attempt, an exception raised in the field, a
-- cancellation after dispatch, a return to origin) were named as required
-- parts of the lifecycle. Measured first (not assumed): marketplace
-- delivery's state machine (@bmpl/shared `DELIVERY_ACTIONS`, which also
-- drives ShipmentLeg.courierStatus) had no edge off its forward track once
-- PICKUP_CONFIRMED was reached except DELIVER itself -- a driver who could
-- not complete a job after pickup had no legal next action at all, and
-- neither did an admin (CANCEL's own `from` list already stopped one state
-- short of pickup, by comment design in packages/shared/src/dispatch.ts).
--
-- This migration adds ONLY the new terminal-ish status and the two columns
-- the driver's own report needs; it contains no DDL that reads or writes
-- the enum value itself (the ADD VALUE statements below are the only
-- references to it in this file). The action's write path
-- (driver-jobs.service.ts, filtered on in driver-job-feed.service.ts) ships
-- in THIS SAME COMMIT, not a later one — correcting an earlier draft of
-- this comment that claimed otherwise.
--
-- Why that is still safe: Postgres's actual restriction is narrower than
-- "don't ship the writer in the same change" — it forbids using a new enum
-- value inside the SAME TRANSACTION that adds it (packages/database/CLAUDE.md
-- §2), and a schema migration and a runtime API write are never the same
-- transaction, regardless of which commit either one ships in. Separately,
-- on THIS repo's deploy pipeline (railway.json preDeployCommand; measured
-- and documented in docs/phase-2/DEPLOYMENT-GUIDE.md and
-- docs/PROJECT_STATUS.md), `prisma migrate deploy` runs inside the freshly
-- built image, after build and before that SAME deployment's container
-- receives traffic — the old version keeps serving until it does, and a
-- failed migration halts the deploy rather than letting the new binary
-- start. Since this migration and its writer are the same commit, they are
-- necessarily the same build and the same deployment, so the enum value is
-- guaranteed to exist in the database before the container that can write
-- it ever takes a request.
--
-- NOT the same fact as ShipmentLeg.exceptionAt/exceptionReason: those are
-- staff/system-driven, live on ShipmentLeg.status (apps/api/src/shipping,
-- a different lifecycle Dwight owns), and already existed. This EXCEPTION
-- value and these two columns are driver-reported, live on
-- OrderDelivery.status, and apply to marketplace delivery only — a courier
-- leg's `courierStatus` can structurally reach the same enum value (it is
-- the same Postgres type) but nothing in this change wires a caller for
-- it, deliberately: a leg already has its own exception mechanism, and
-- giving courierStatus a second, independent one would be two sources for
-- one fact.
--
-- ROLLBACK: cannot remove an enum value Postgres has ever stored a row
-- against — not reversible by a migration, same as every other
-- DeliveryStatus/AuditAction addition in this schema. The two new columns
-- are nullable and additive; dropping them is reversible, dropping the
-- enum value is not.

ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'EXCEPTION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELIVERY_EXCEPTION_RAISED';

ALTER TABLE "order_deliveries"
  ADD COLUMN "exceptionAt" TIMESTAMP(3),
  ADD COLUMN "exceptionReason" TEXT;
