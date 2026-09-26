/**
 * Known, acknowledged orphans in NOTIFICATION_EVENTS — the baseline for
 * scripts/detect-notification-event-catalog-drift.mjs (BMPL-220 follow-up).
 *
 * These 11 catalog entries have zero call sites TODAY, on purpose, not by
 * accident: calling an unused entry dead code and deleting it is a product
 * decision (BMPL-219's ruling), not something this checker gets to make. But
 * an orphan the checker reports EVERY SINGLE RUN, forever, trains whoever
 * reads it to stop reading — the exact "always-red gets muted" trap god
 * named on the citation checker's own history. This file is how a KNOWN
 * orphan stops being red without a human ever deleting a real defect from
 * the report by accident: adding a code here is a reviewable, deliberate
 * edit to a small file, not a silent change buried inside the checker's own
 * logic.
 *
 * Every entry MUST have a real, non-empty reason. The checker treats an
 * empty reason as a defect in THIS file, not a free pass — "accepted, no
 * comment" is exactly the silent acceptance this file exists to prevent.
 *
 * If a listed code stops being an orphan (someone wires it up), the checker
 * flags the entry as STALE rather than silently keeping quiet about it —
 * good news should still surface, so this file doesn't quietly accumulate
 * cruft either.
 */
export const KNOWN_ORPHANS = {
  // BMPL-219's own architectural ruling: the single shared DeliveryCoreService.notify()
  // already fans one DELIVERY_-prefixed event to customer, vendor AND driver together,
  // so a separate DRIVER_-prefixed twin for the same moment was never wired — not a gap,
  // a fact about the architecture. Confirmed by reading the ruling, not assumed.
  DRIVER_NEW_ASSIGNMENT: "BMPL-219: no separate driver-only notification channel exists — the shared notify() already reaches the driver via a DELIVERY_-prefixed event.",
  DRIVER_DELIVERY_COMPLETED: "BMPL-219: same architectural fact as DRIVER_NEW_ASSIGNMENT — DELIVERY_DELIVERED already reaches the driver via the shared notify().",
  DRIVER_VEHICLE_MODERATED: "BMPL-219: same architectural fact — no separate driver-only channel exists for this event either.",

  // The remaining 8 were confirmed ORPHANED on 2026-09-27 by
  // detect-notification-event-catalog-drift.mjs and cross-checked by hand
  // (each name grepped standalone across apps/api/src, zero hits, matching
  // BMPL-215's own methodology) — but WHY each one has never been wired is
  // NOT YET INVESTIGATED. Recorded honestly as unconfirmed rather than
  // guessed at: inventing a reason here would be exactly the "invent a
  // business rule" mistake root CLAUDE.md warns against. Whoever
  // investigates one of these should replace its reason with the real
  // answer, which then also serves as this file's own proof that the entry
  // was looked at, not just carried forward by habit.
  ORDER_CANCELLED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  VENDOR_APPROVED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  VENDOR_REJECTED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  PRODUCT_MODERATED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  ROLE_STATUS_CHANGED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  ROLE_MORE_INFO_REQUESTED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  ADMIN_SECURITY_ALERT: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
  CONVERSATION_CLOSED: 'Orphaned as of 2026-09-27, cause not yet investigated. Confirmed zero call sites; not confirmed why.',
};
