/**
 * The leg-state vocabulary the logistics ops board (`/dashboard/logistics`)
 * uses, extracted so the single-shipment detail page
 * (`/dashboard/logistics/[reference]`) can render the SAME words for the
 * SAME leg once its own payload carries the fields this reads.
 *
 * P2-SHIPMENT-PARITY: today the two admin screens disagree for the exact
 * same leg — the ops board shows "No driver found" / "No carrier assigned"
 * for a stuck leg; the detail page shows only the bare `status` enum, with
 * no way to tell a stuck leg from an ordinarily-queued one. The root cause
 * is NOT this function — it's that `ShipmentService.serialize()` (the
 * single-shipment endpoint the detail page calls) never selects
 * `needsDriverReason`/the dispatch-exhaustion fields `listForOps` does, so
 * the detail page's own `Leg` type has nothing to pass in. That's routed to
 * the API owner. Once her PR lands the matching field(s) on `serialize()`'s
 * leg shape, the detail page's fix is: add the field(s) to its own `Leg`
 * interface (read her PR for the exact name — do not guess it here) and
 * call `legState(leg)` where it currently renders a bare status badge.
 *
 * Until then this is a pure extraction, not a behavior change: moved out of
 * `logistics/page.tsx` verbatim so there is exactly one place this
 * vocabulary is defined, not two drifting copies the moment the detail page
 * gets its own fields to feed it.
 */

export interface LegStateInput {
  kind: string;
  status: string;
  operator: string | null;
  operatedByProviderId: string | null;
  needsDriver: boolean;
  /** Optional/additive — see each caller's own field comment for why. */
  needsDriverReason?: 'EXHAUSTED' | 'UNAVAILABLE' | null;
}

/**
 * MDF-560 (owner): "booked but no carrier to move it" must read as awaiting
 * fulfilment, not as ordinary progress. A LINE_HAUL leg is never dispatched
 * to a driver, so `needsDriver` (dispatch exhaustion) can never fire for
 * one, and without this check an unassigned transport leg fell through to
 * the same neutral "Waiting" every ordinarily-queued leg gets.
 */
export function legNeedsCarrier(leg: LegStateInput): boolean {
  return (
    leg.kind === 'LINE_HAUL' &&
    !leg.operator &&
    !leg.operatedByProviderId &&
    leg.status !== 'COMPLETED' &&
    leg.status !== 'CANCELLED' &&
    leg.status !== 'EXCEPTION'
  );
}

export type LegStateTone = 'neutral' | 'info' | 'success' | 'warning';

/** The leg's own state, in the vocabulary the operator uses out loud. */
export function legState(leg: LegStateInput): { label: string; tone: LegStateTone } {
  if (leg.status === 'COMPLETED') return { label: 'Done', tone: 'success' };
  if (leg.status === 'EXCEPTION') return { label: 'Problem', tone: 'warning' };
  if (leg.status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
  // CLOSE-20: UNAVAILABLE ("nobody was ever eligible to ask") is a different
  // claim from EXHAUSTED ("we asked everyone and nobody took it") and can
  // resolve on its own the moment a driver comes online, which exhaustion
  // cannot — so it gets its own badge, in a tone that doesn't read as the
  // same hand-assign alarm. The backend already resolves EXHAUSTED first
  // whenever a leg could claim both, so checking this branch first never
  // shadows an exhausted leg.
  if (leg.needsDriverReason === 'UNAVAILABLE') return { label: 'No driver online', tone: 'info' };
  if (leg.needsDriver) return { label: 'No driver found', tone: 'warning' };
  if (legNeedsCarrier(leg)) return { label: 'No carrier assigned', tone: 'warning' };
  if (leg.status === 'IN_PROGRESS') return { label: 'Moving', tone: 'info' };
  if (leg.status === 'READY') return { label: 'Ready', tone: 'info' };
  return { label: 'Waiting', tone: 'neutral' };
}

/**
 * MDF-624: the line god drew explicitly — the API hands over a raw instant,
 * never an "is this stale" verdict, so the threshold for "too long" has to
 * live here, where an operator can read it in the source and argue with it.
 * 24 hours is a judgement call, not a derived fact.
 */
export const MANUAL_ASSIGNMENT_STALE_HOURS = 24;

export function manualAssignmentIsStale(iso: string): boolean {
  const hours = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  return hours >= MANUAL_ASSIGNMENT_STALE_HOURS;
}
