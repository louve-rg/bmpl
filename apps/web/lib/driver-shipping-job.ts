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
 * `job.addressUnlocked` is the same gate the address reveal already uses —
 * there is nothing to photograph at a door you have not committed to yet.
 * `canAct` is whether the leg still has a next action (false once
 * COMPLETED/CANCELLED/EXCEPTION), matching the API's own refusal window on
 * `confirmPickupPhoto`. `pickupPhotoUrls` absent is treated exactly like
 * empty — web and api deploy independently, and a required field read
 * unguarded is how a screen crashes on the api side lagging behind a merge
 * (BMPL-349).
 */
export function pickupPhotoSection(
  job: { addressUnlocked: boolean; pickupPhotoUrls?: string[] },
  canAct: boolean,
): PickupPhotoSection {
  if (!job.addressUnlocked) return 'hidden';
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
