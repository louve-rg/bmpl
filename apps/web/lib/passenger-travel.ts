/**
 * The rider's side of passenger transport: response shapes and the honesty
 * rules the copy must hold. Plain data, no React, testable without a renderer.
 *
 * The rule that matters most here: SEATS ARE HELD AT CONFIRMATION, NOT AT
 * REQUEST. A rider's request reserves nothing, and a person will plan travel
 * around what this screen says — so the REQUESTED wording states plainly that
 * no seat is held yet, and nothing may imply otherwise.
 */

/** One row of `GET /passenger/departures`. */
export interface Departure {
  id: string;
  reference: string;
  status: string;
  scheduledDepartureAt: string;
  scheduledArrivalAt: string | null;
  route: {
    name: string;
    originDistrict: string;
    originCity: string;
    destinationDistrict: string;
    destinationCity: string;
    scheduleNote: string | null;
    durationMinutes: number | null;
  };
  operator: string | null;
  /** The operator's configured figure, verbatim minor units — never computed on. */
  baseFareMinor: number | null;
  /** The server's own fare-gate answer: false means booking is refused. */
  fareConfigured: boolean;
  seatCapacity: number | null;
  seatsConfirmed: number;
}

/** One row of `GET /passenger/bookings` (the rider's own). */
export interface RiderBooking {
  id: string;
  reference: string;
  status: string;
  seats: number;
  tripId: string | null;
  tripReference: string | null;
  tripStatus: string | null;
  scheduledDepartureAt: string | null;
  routeName: string | null;
  from: string | null;
  to: string | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
}

/**
 * Seats still available to confirm, or null when unknowable — capacity is
 * snapshotted from the vehicle at assignment, so an unstaffed departure has
 * no capacity yet and the UI must say "not yet known", never invent a number.
 */
export function seatsLeft(seatCapacity: number | null, seatsConfirmed: number): number | null {
  if (seatCapacity == null) return null;
  return Math.max(seatCapacity - seatsConfirmed, 0);
}

export type RiderBookingTone = 'success' | 'warning' | 'error' | 'neutral';

/**
 * What each booking status means to the rider, in words that keep the
 * held-at-confirmation rule: REQUESTED explicitly says no seat is held.
 */
export function riderBookingView(status: string): { label: string; detail: string | null; tone: RiderBookingTone; cancellable: boolean } {
  switch (status) {
    case 'REQUESTED':
      return {
        label: 'Requested',
        detail: 'Waiting for the operator to confirm. No seat is held yet — plan accordingly.',
        tone: 'warning',
        cancellable: true,
      };
    case 'CONFIRMED':
      return { label: 'Confirmed', detail: 'Your seats are held on this departure.', tone: 'success', cancellable: true };
    case 'COMPLETED':
      return { label: 'Completed', detail: null, tone: 'neutral', cancellable: false };
    case 'CANCELLED':
      return { label: 'Cancelled', detail: null, tone: 'error', cancellable: false };
    default:
      return { label: status, detail: null, tone: 'neutral', cancellable: false };
  }
}
