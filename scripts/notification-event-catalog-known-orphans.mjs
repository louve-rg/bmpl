/**
 * Known, acknowledged orphans in NOTIFICATION_EVENTS — the baseline for
 * scripts/detect-notification-event-catalog-drift.mjs (BMPL-220 follow-up).
 *
 * These 5 catalog entries have zero call sites TODAY, on purpose, not by
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

  // The remaining 8 were confirmed ORPHANED on 2026-09-27 and investigated
  // (BMPL-229): six turned out to be a fourth shape the original taxonomy
  // didn't name — the right person WAS already notified with the right
  // content, the call just never set an `event:` key (or, for
  // ORDER_CANCELLED, set the WRONG one — a copy-paste of the order-placed
  // literal onto the cancellation notification). None of that was an
  // architectural fact, so none of it belonged in this file as one; BMPL-230
  // added the missing/corrected literal at each call site instead, which is
  // why those six are gone from this list rather than explained here.
  // The two below could not be resolved that way — a real answer, not a
  // reason to invent one.
  ADMIN_SECURITY_ALERT: 'Investigated 2026-09-27 (BMPL-229): no security-detection logic of any kind exists anywhere in apps/api/src (no lockout, anomaly, fraud or permission-escalation alert) for this event to attach to. Added in the original M16 commit alongside ADMIN_FAILED_DELIVERY (which IS used) but never built. Naming a call site would mean inventing what "security alert" should detect — filed as a blocked product question, not fixed.',
  CONVERSATION_CLOSED: 'Investigated 2026-09-27 (BMPL-229): messaging.service.ts close() audits the closure and posts a SYSTEM message into the thread, but never calls a notification method — unlike sendMessage(), which calls notifyOthers() for every real message. The other participant is never told the conversation closed. Genuine gap, not architecture; the fix (a notifyOthers() call in close(), same audience sendMessage already uses) is tracked as BMPL-231, not done here.',
};
