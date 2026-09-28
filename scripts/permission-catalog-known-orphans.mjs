/**
 * Known, acknowledged orphans in PERMISSIONS — the baseline for
 * scripts/detect-permission-catalog-drift.mjs (BMPL-304).
 *
 * These 2 catalog entries have zero enforcement sites TODAY, on purpose, not
 * by accident: BMPL-31 found them by hand and the card is OPEN and BLOCKED on
 * the owner, not resolved — calling them dead code and deleting them is the
 * same product decision BMPL-219 reserved for the notification catalog's own
 * orphans, and this checker does not get to make it either. But an orphan
 * this checker reports every single run, forever, trains whoever reads it to
 * stop reading — the exact "always-red gets muted" trap the notification
 * checker's own baseline exists to avoid. This file is how an ALREADY-HELD
 * orphan stops being red without silently dropping a real one: adding a code
 * here is a reviewable, deliberate edit to a small file, sourced from an
 * actual open card, not a silent change buried inside the checker's own
 * logic.
 *
 * Every entry MUST have a real, non-empty reason. The checker treats an
 * empty reason as a defect in THIS file, not a free pass.
 *
 * If a listed code stops being an orphan (someone builds the surface), the
 * checker flags the entry as STALE rather than silently keeping quiet.
 *
 * NOTE for whoever next investigates a permission orphan: `logistics.verify`
 * — found orphaned by hand in the SAME investigation that found these two
 * (this card's own dispatch calls it "the same family") — is deliberately
 * NOT listed here, because it is no longer orphaned: apps/api/src/shipping/
 * shipping.controller.ts:480 now enforces it on the leg handoff-PIN reveal
 * route. That route is a real, separate, already-built feature (the reveal,
 * not the override BMPL-13 is still blocked on) — the code moved on since
 * the hand investigation, and this checker's whole point is to notice that
 * kind of thing before a stale note gets carried forward as still true.
 */
export const KNOWN_ORPHANS = {
  'agencies.read': 'BMPL-31 (open, blocked on the owner): no admin agency endpoints or UI exist at all — a missing surface, not a mis-guarded one. The only agency-facing surface today is agent self-service.',
  'agencies.moderate': 'BMPL-31 (open, blocked on the owner): same missing surface as agencies.read — approve/suspend agencies has nothing to attach to yet.',
};
