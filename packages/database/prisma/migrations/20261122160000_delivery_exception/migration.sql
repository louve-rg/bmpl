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
-- the driver's own report needs. It is the schema half of that fix; the
-- action itself (RAISE_EXCEPTION) and its one legal way out (CANCEL,
-- admin-only) are packages/shared/src/dispatch.ts, not this file.
--
-- ADD ONLY: nothing below references the new enum value in the same
-- transaction that adds it — Postgres refuses that combination (see
-- packages/database/CLAUDE.md §2). The service code that writes it is a
-- separate, later change.
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
