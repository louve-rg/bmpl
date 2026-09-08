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

/**
 * One ordered stop of a route, exactly as the operator entered it. `sequence`
 * is the operator's numbering as stored — the UI renders it verbatim and never
 * sorts, renumbers or re-derives the order. The sequence is authority: it is
 * what answers "does this bus stop for me?" for a person boarding between the
 * endpoints, which in Belize is the common case.
 */
export interface RouteStop {
  sequence: number;
  district: string;
  city: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * One row of `GET /passenger/services` — a service that EXISTS, whether or not
 * anything is currently scheduled on it. An unpriced service is deliberately
 * present with `fareConfigured` false (the pricing-unavailable state); the
 * fare gate still refuses any booking on it server-side.
 */
export interface PassengerService {
  id: string;
  name: string;
  description: string | null;
  originDistrict: string;
  originCity: string;
  destinationDistrict: string;
  destinationCity: string;
  scheduleNote: string | null;
  durationMinutes: number | null;
  stops: RouteStop[];
  operator: string | null;
  baseFareMinor: number | null;
  fareConfigured: boolean;
}

/**
 * `GET /passenger/departures/:id` — the list row byte-for-byte, plus the
 * route's ordered stops (the one thing the list omits). Anything the list
 * would hide answers 404, indistinguishable from nonexistent.
 */
export interface DepartureDetail extends Omit<Departure, 'route'> {
  route: Departure['route'] & { stops: RouteStop[] };
}

/**
 * What to call a stop: its name when the operator gave one, otherwise the
 * town itself — both are the operator's own data, nothing invented.
 */
export function stopLabel(stop: Pick<RouteStop, 'name' | 'city'>): string {
  const name = stop.name?.trim();
  return name ? name : stop.city;
}

/**
 * How a failed rider-surface load is presented. A 403 here is a decision
 * about the ACCOUNT (a restricted/suspended customer role), not a malfunction
 * — so it renders calm and plain, carrying the server's own sentence, with no
 * error styling and no invented remedy channel. Everything else is a real
 * error and stays one.
 */
export function riderAccessView(
  status: number | undefined,
  serverMessage: string,
): { kind: 'restricted'; title: string; detail: string } | { kind: 'error'; detail: string } {
  if (status === 403) {
    return { kind: 'restricted', title: 'Not available on your account', detail: serverMessage };
  }
  return { kind: 'error', detail: serverMessage };
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
