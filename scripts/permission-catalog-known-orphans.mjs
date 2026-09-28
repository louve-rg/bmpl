/**
 * Known, acknowledged orphans in PERMISSIONS — the baseline for
 * scripts/detect-permission-catalog-drift.mjs (BMPL-304).
 *
 * These 3 catalog entries have zero enforcement sites TODAY, on purpose, not
 * by accident: each was found (by hand, or by this checker's own first run)
 * and filed as its own OPEN card, BLOCKED on the owner, not resolved —
 * calling one dead code and deleting it, or building the surface for it, is
 * the same product decision BMPL-219 reserved for the notification catalog's
 * own orphans, and this checker does not get to make it either. But an
 * orphan this checker reports every single run, forever, trains whoever
 * reads it to stop reading — the exact "always-red gets muted" trap the
 * notification checker's own baseline exists to avoid. This file is how an
 * ALREADY-FILED orphan stops being red without silently dropping a real one:
 * adding a code here is a reviewable, deliberate edit to a small file,
 * sourced from an actual open card with a number a reader can go read, not a
 * silent change buried inside the checker's own logic — BASELINING RECORDS A
 * FINDING, IT DOES NOT DECIDE IT. An entry here is never a claim that the gap
 * is fine; it is a claim that a human has already been asked.
 *
 * Every entry MUST have a real, non-empty reason. The checker treats an
 * empty reason as a defect in THIS file, not a free pass.
 *
 * If a listed code stops being an orphan (someone builds the surface), the
 * checker flags the entry as STALE rather than silently keeping quiet.
 *
 * NOTE for whoever next investigates a permission orphan: `logistics.verify`
 * — found orphaned by hand in the SAME investigation that found agencies.read/
 * agencies.moderate below (this card's own dispatch calls it "the same
 * family") — is deliberately NOT listed here, because it is no longer
 * orphaned: apps/api/src/shipping/shipping.controller.ts:480 now enforces it
 * on the leg handoff-PIN reveal route. That route is a real, separate,
 * already-built feature (the reveal, not the override BMPL-13 is still
 * blocked on) — the code moved on since the hand investigation, and this
 * checker's whole point is to notice that kind of thing before a stale note
 * gets carried forward as still true.
 */
export const KNOWN_ORPHANS = {
  'agencies.read': 'BMPL-31 (open, blocked on the owner): no admin agency endpoints or UI exist at all — a missing surface, not a mis-guarded one. The only agency-facing surface today is agent self-service.',
  'agencies.moderate': 'BMPL-31 (open, blocked on the owner): same missing surface as agencies.read — approve/suspend agencies has nothing to attach to yet.',
  // Found by THIS checker's own first run (BMPL-304), not by hand — and worse
  // than a plain orphan: it is GRANTED, not merely catalogued (present in
  // PERMISSION_BUNDLES.ADMIN too), so every ADMIN carries a permission that
  // gates absolutely nothing. Filed as BMPL-311, open, unexplained, NOT
  // accepted, owner-gated — the identical form as agencies.* above. This
  // entry records that a human has been asked; it does not decide whether
  // the answer is "build the broadcast feature" or "strip the permission".
  'notifications.broadcast': 'BMPL-311 (open, unexplained, owner-gated): granted in PERMISSION_BUNDLES.ADMIN but enforced nowhere — no admin broadcast endpoint exists anywhere in apps/api/src. Not accepted as correct; filed for the owner to decide whether to build it or remove it.',
};
