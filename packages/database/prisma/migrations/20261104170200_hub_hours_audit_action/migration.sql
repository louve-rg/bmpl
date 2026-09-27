-- One audit action for the hub hours configuration surface (BMPL-263),
-- same shape as ROUTE_SCHEDULE_CHANGED (BMPL-186): the weekly pattern being
-- replaced, an exception being added, or an exception being removed are all
-- this one action, with the verb travelling in the audit row's newValue —
-- not three separate enum values for what is one surface being edited.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'HUB_HOURS_CHANGED';
