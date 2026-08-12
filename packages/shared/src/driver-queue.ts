/**
 * Driver-facing delivery views + queue semantics (M26.3 client feedback).
 *
 * The client asked My Deliveries to offer ASSIGNED / AVAILABLE / ACTIVE /
 * COMPLETED. None of those are delivery statuses, and inventing four new statuses
 * to match four tabs would put presentation in charge of the state machine — the
 * exact inversion the dispatch incident was caused by. So this module is a
 * PRESENTATION MAPPING and nothing else: it reads the existing `DeliveryStatus`
 * (plus `acceptedAt`, which is what distinguishes an outstanding offer from an
 * accepted job) and answers which tab the row belongs under.
 *
 * Pure and framework-free so the API and the web app cannot disagree about what
 * "Active" means, and so the mapping is unit-testable without a database.
 *
 * IMPORTANT: no function here grants access to anything. Every caller has already
 * filtered to deliveries owned by the calling driver; these functions only decide
 * how an already-authorized row is displayed and ordered.
 */

import type { DeliveryStatus } from './dispatch';

/** The four driver-facing views, in the order the client asked for them. */
export const DRIVER_DELIVERY_VIEWS = ['available', 'assigned', 'active', 'completed'] as const;
export type DriverDeliveryView = (typeof DRIVER_DELIVERY_VIEWS)[number];

export const DRIVER_VIEW_LABELS: Record<DriverDeliveryView, string> = {
  available: 'Available',
  assigned: 'Assigned',
  active: 'Active',
  completed: 'Completed',
};

export const DRIVER_VIEW_DESCRIPTIONS: Record<DriverDeliveryView, string> = {
  available: 'Offered to you — accept or decline before the offer passes on.',
  assigned: 'Yours, waiting to be collected from the store.',
  active: 'Picked up and on the road.',
  completed: 'Delivered.',
};

/**
 * Which delivery statuses can appear under each view.
 *
 * `available` and `assigned` share the ASSIGNED status because the state machine
 * has no separate "offered" state — a delivery is offered by being ASSIGNED to a
 * driver with `acceptedAt` still null. `driverViewForStatus` is what splits them;
 * this map exists so a database query can narrow the rows first.
 */
export const DRIVER_VIEW_STATUSES: Record<DriverDeliveryView, readonly DeliveryStatus[]> = {
  available: ['ASSIGNED'],
  assigned: ['ASSIGNED', 'DRIVER_ACCEPTED'],
  active: ['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'],
  completed: ['DELIVERED'],
};

/** Every status that puts a delivery on a driver's plate right now. */
export const DRIVER_OPEN_STATUSES: readonly DeliveryStatus[] = [
  'ASSIGNED',
  'DRIVER_ACCEPTED',
  'PICKUP_CONFIRMED',
  'IN_TRANSIT',
  'ARRIVING',
];

export function isDriverDeliveryView(v: string | null | undefined): v is DriverDeliveryView {
  return v != null && (DRIVER_DELIVERY_VIEWS as readonly string[]).includes(v);
}

/**
 * The single view a delivery belongs to, or null when it belongs in none of them
 * (PENDING_ASSIGNMENT, DRIVER_DECLINED and CANCELLED are not the driver's work).
 *
 * ASSIGNED splits on `acceptedAt`: an unanswered offer is AVAILABLE (there is a
 * decision to make and a clock running), an accepted one is ASSIGNED (it is
 * theirs, and the next thing to do is drive to the store). Accepting also sets
 * the status to DRIVER_ACCEPTED, so the `ASSIGNED + acceptedAt` case only arises
 * in the instant between the two writes — it is mapped anyway rather than left to
 * fall through, because a row that briefly belongs to no tab is a row that
 * briefly vanishes from the driver's screen.
 */
export function driverViewForStatus(
  status: DeliveryStatus,
  acceptedAt: Date | string | null | undefined,
): DriverDeliveryView | null {
  switch (status) {
    case 'ASSIGNED':
      return acceptedAt ? 'assigned' : 'available';
    case 'DRIVER_ACCEPTED':
      return 'assigned';
    case 'PICKUP_CONFIRMED':
    case 'IN_TRANSIT':
    case 'ARRIVING':
      return 'active';
    case 'DELIVERED':
      return 'completed';
    default:
      return null;
  }
}

/* --------------------------------------------------------------- next action */

/**
 * The single next thing the driver must do, derived from the status. `action` is
 * the corresponding entry in DELIVERY_ACTIONS, so this can never suggest a step
 * the state machine would reject.
 */
export type DriverNextAction =
  | { kind: 'ACCEPT'; label: string }
  | { kind: 'CONFIRM_PICKUP'; label: string }
  | { kind: 'IN_TRANSIT'; label: string }
  | { kind: 'ARRIVING'; label: string }
  | { kind: 'DELIVER'; label: string }
  | { kind: 'NONE'; label: string };

export function nextDriverAction(
  status: DeliveryStatus,
  acceptedAt: Date | string | null | undefined,
): DriverNextAction {
  switch (status) {
    case 'ASSIGNED':
      return acceptedAt
        ? { kind: 'CONFIRM_PICKUP', label: 'Collect from the store' }
        : { kind: 'ACCEPT', label: 'Accept or decline' };
    case 'DRIVER_ACCEPTED':
      return { kind: 'CONFIRM_PICKUP', label: 'Collect from the store' };
    case 'PICKUP_CONFIRMED':
      return { kind: 'IN_TRANSIT', label: 'Start the drop-off' };
    case 'IN_TRANSIT':
      return { kind: 'ARRIVING', label: 'Mark arriving' };
    case 'ARRIVING':
      return { kind: 'DELIVER', label: 'Complete the delivery' };
    default:
      return { kind: 'NONE', label: 'Nothing to do' };
  }
}

/* ------------------------------------------------------------- queue stops */

/**
 * Which end of the journey a delivery is currently at.
 *
 * This is the property that makes route ordering lifecycle-safe. A delivery
 * contributes exactly ONE stop to the route at a time: the store until it has
 * been collected, the customer after. There is therefore no arrangement of the
 * queue in which a drop-off is sequenced before its own pickup, because the
 * drop-off is not a candidate stop until the pickup has actually happened.
 */
export type QueueStopKind = 'PICKUP' | 'DROPOFF';

export function queueStopKind(status: DeliveryStatus): QueueStopKind {
  return status === 'ASSIGNED' || status === 'DRIVER_ACCEPTED' ? 'PICKUP' : 'DROPOFF';
}

/**
 * May the driver move this job around their queue?
 *
 * Reordering is a note-to-self about which job to do next; it changes no
 * ownership, no status and no money. It is still refused for two cases:
 *
 * - an unaccepted OFFER, because it is not yet the driver's work to sequence and
 *   pinning it in a queue would suggest otherwise; and
 * - a delivery already being handed over (ARRIVING), because the driver is
 *   standing at the door and "do this third" is meaningless.
 */
export function canReorderQueueItem(
  status: DeliveryStatus,
  acceptedAt: Date | string | null | undefined,
): boolean {
  if (status === 'ASSIGNED' && !acceptedAt) return false;
  return status === 'ASSIGNED' || status === 'DRIVER_ACCEPTED' || status === 'PICKUP_CONFIRMED' || status === 'IN_TRANSIT';
}

/** Why a job is pinned in place, for the UI to explain rather than silently disable. */
export function reorderBlockedReason(
  status: DeliveryStatus,
  acceptedAt: Date | string | null | undefined,
): string | null {
  if (canReorderQueueItem(status, acceptedAt)) return null;
  if (status === 'ASSIGNED' && !acceptedAt) return 'Accept this offer before adding it to your route.';
  if (status === 'ARRIVING') return 'You’re arriving at this drop — finish it before reordering.';
  return 'This delivery can no longer be reordered.';
}
