/**
 * Known, acknowledged orphans in NOTIFICATION_EVENTS — the baseline for
 * scripts/detect-notification-event-catalog-drift.mjs (BMPL-220 follow-up).
 *
 * These 4 catalog entries have zero call sites TODAY, on purpose, not by
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
  // CONVERSATION_CLOSED, the other entry BMPL-229 left here, is gone from
  // this list as of BMPL-231: close() now calls notifyUsers() (the same
  // audience sendMessage() already notifies), so the event has a real call
  // site and the checker resolves it on its own. ADMIN_SECURITY_ALERT is
  // gone from this list as of BMPL-232, once owner ruling 4 drew the actual
  // line: not a detector on invented heuristics, but a restatement of two
  // security events BMPL already asserts with certainty — an admin locking
  // or unlocking a wallet (wallet.service.ts setUserWalletLock) and an
  // admin's own permission set changing (admin.service.ts setPermissions).
  // Both fire ADMIN_SECURITY_ALERT with a real call site now.
};
