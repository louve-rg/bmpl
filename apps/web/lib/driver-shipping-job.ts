/**
 * Pure view logic for the shipping courier's job detail — kept out of the
 * page component so it can be unit-tested without a DOM (same convention as
 * lib/driver-job.ts, the marketplace equivalent).
 */

export type PickupPhotoSection = 'hidden' | 'existing' | 'addable';

/**
 * Which of the three pickup-photo states to render (BMPL-178/352, Edward
 * req 2) — decided once, pure, so the "only offer 'add' when nothing is
 * attached yet" rule (see the page's own `addPhoto` comment for why a
 * second session cannot safely add to a first, since `confirmPickupPhoto`
 * replaces the stored keys wholesale and the read side never returns the
 * underlying keys back) can't drift between JSX branches.
 *
 * Gated on acceptance, not `addressUnlocked`: since SHIP-B, `addressUnlocked`
 * is structurally always true for a leg's own door from offer time on, so it
 * no longer tracks "has this driver committed to the job" the way it did
 * when this function was written. `contactUnlocked` is the field that still
 * does — it stays acceptance-gated — with `addressUnlocked` as the fallback
 * for an api deploy older than SHIP-B, where `contactUnlocked` is absent and
 * `addressUnlocked` is still the real pre/post-accept gate. There is nothing
 * to photograph at a door you have not committed to yet.
 * `canAct` is whether the leg still has a next action (false once
 * COMPLETED/CANCELLED/EXCEPTION), matching the API's own refusal window on
 * `confirmPickupPhoto`. `pickupPhotoUrls` absent is treated exactly like
 * empty — web and api deploy independently, and a required field read
 * unguarded is how a screen crashes on the api side lagging behind a merge
 * (BMPL-349).
 */
export function pickupPhotoSection(
  job: { addressUnlocked: boolean; contactUnlocked?: boolean; pickupPhotoUrls?: string[] },
  canAct: boolean,
): PickupPhotoSection {
  if (!(job.contactUnlocked ?? job.addressUnlocked)) return 'hidden';
  if (job.pickupPhotoUrls && job.pickupPhotoUrls.length > 0) return 'existing';
  return canAct ? 'addable' : 'hidden';
}

export type ReportIssueState = 'available' | 'reported' | 'unavailable';

/**
 * Which courier statuses may report a failed-delivery-shaped issue (MDF-96 /
 * Edward req 10, POST /driver/shipping-jobs/:id/report-issue) -- mirrors
 * apps/api's REPORTABLE_COURIER_STATUSES (shipment-driver.service.ts)
 * client-side. Duplicated rather than imported: that constant lives in
 * apps/api, out of scope for this apps/web-only change. The server stays
 * authoritative regardless -- it re-checks this exact window on every POST
 * and refuses with its own clear message if this mirror is ever wrong, same
 * pattern as the order-cancel page's `cancellable` flag.
 *
 * Does NOT include EXCEPTION: a leg already in EXCEPTION is refused by the
 * same backend call this mirrors anyway (`flagException` is routed through
 * `transition()`, whose first gate is `isLegActionable`, which returns false
 * once `status === 'EXCEPTION'` -- packages/shared/src/shipping.ts). Report
 * an issue was never reachable from EXCEPTION in the first place; callers
 * additionally check `isExceptionBlocked` below for the same reason #398
 * hides the primary action -- offering a control the server would refuse.
 */
const REPORTABLE_STATUSES = new Set(['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING']);

/**
 * `reportedThisSession` wins once true, for the rest of the page's life.
 * NOT durable across a reload: the driver job view
 * (ShipmentDriverService#serialize) returns `courierStatus` only, never the
 * leg's separate `status`/`exceptionReason`/`exceptionAt` fields that
 * `flagException` actually writes -- so there is currently no server signal
 * this function could read instead. Flagged in the page's own top comment,
 * not silently worked around.
 */
export function reportIssueState(status: string, reportedThisSession: boolean): ReportIssueState {
  if (reportedThisSession) return 'reported';
  return REPORTABLE_STATUSES.has(status) ? 'available' : 'unavailable';
}

/**
 * Owner ruling (god, conv-mission-2026-10-13): an active delivery exception
 * blocks further courier progression until authorized staff resolve it — in
 * backend transitions (apps/api's own guard) AND here. `legStatus` is
 * additive/optional on the wire — the leg's own `status` (PENDING / READY /
 * IN_PROGRESS / EXCEPTION), distinct from the driver-facing `courierStatus`
 * the rest of this job object is built from, and not guaranteed to have
 * started arriving on every deploy yet (same BMPL-349/350 degrade-to-today
 * pattern as `routeStops`/`pickupPhotoUrls`). Absent, this returns false —
 * the pre-existing, unblocked behaviour — never a false block.
 *
 * Also gates Report-an-issue (MDF-96/req 10, see `reportIssueState` above):
 * resolved 2026-10-14 reconciling #393 against this PR. Report-an-issue
 * calls `flagException`, which is refused by the exact same backend gate
 * once a leg is already EXCEPTION (see the comment on `REPORTABLE_STATUSES`)
 * — it is one of the controls this rule exists to stop offering, not an
 * exception to it.
 */
export function isExceptionBlocked(job: { legStatus?: string | null }): boolean {
  return job.legStatus === 'EXCEPTION';
}

/**
 * MDF-717: whether this screen should fetch and show the courier's OWN
 * code to present at the hub counter, instead of telling him to go ask
 * someone else for it.
 *
 * ARRIVING + FIRST_MILE only. `ShipmentService.revealCourierCode` (TERM-5)
 * only ever returns a courier's OWN code for FIRST_MILE (handoffPin, the
 * code he presents when handing a parcel TO a hub) and LAST_MILE
 * (pickupPin, the code he presents when COLLECTING a parcel FROM a hub) —
 * never for a door end, where the code belongs to whoever is physically
 * there (the sender at pickup, the recipient at delivery), not the driver.
 * The LAST_MILE/pickupPin moment has no existing screen at all yet
 * (`requiresPickupPin`, the only pin field pickup already renders, is
 * scoped to a SENDER's door code on FIRST_MILE/DIRECT — see its own doc —
 * so a LAST_MILE driver collecting from a hub has nothing to key off of
 * today) — out of scope here, which only covers the ARRIVING/handoff
 * screen Stanley actually hit a dead end on.
 *
 * A LAST_MILE or DIRECT leg's own ARRIVING/handoff screen stays exactly as
 * it was: that is the final door delivery, where the RECIPIENT holds
 * their own delivery code and asking them for it is correct.
 */
export function showsOwnHandoffCode(jobKind: string, status: string): boolean {
  return jobKind === 'FIRST_MILE' && status === 'ARRIVING';
}
