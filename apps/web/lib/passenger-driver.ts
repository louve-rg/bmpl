import { DRIVER_SETTABLE_AVAILABILITY } from '@bmpl/shared';

/**
 * Passenger-driver surface: response shapes and presentation rules.
 *
 * Carrying passengers is a different job from carrying parcels — deliberately a
 * separate API module, role and vocabulary — so these types mirror
 * `/passenger/driver/*` serializations, not the delivery driver's. Plain data,
 * no React, so the rules here are testable without a renderer.
 */

export type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;

export type PassengerAvailability = 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';

export interface PassengerDriverProfile {
  id: string;
  legalName: string;
  displayName: string;
  phone: string;
  homeDistrict: string;
  homeAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  licenceNumber: string;
  licenceExpiry: string | null;
  licenceExpiryStatus?: ExpiryStatus;
  availability: PassengerAvailability;
  /** The driver's own affiliation (BMPL-39): identity only, no roster, no commercial fields. */
  providerProfileId?: string | null;
  provider?: { id: string; businessName: string } | null;
  isActive?: boolean;
  isTest?: boolean;
  ratingAverage?: number | null;
  completedTrips?: number;
  createdAt?: string;
}

export interface PassengerVehicle {
  id: string;
  type: string;
  make: string;
  model: string;
  year?: number | null;
  color?: string | null;
  licencePlate: string;
  registrationNumber?: string | null;
  registrationExpiry?: string | null;
  registrationExpiryStatus?: ExpiryStatus;
  insuranceProvider?: string | null;
  insuranceExpiry?: string | null;
  insuranceExpiryStatus?: ExpiryStatus;
  seatCapacity: number;
  isActive: boolean;
  isPrimary: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
}

export interface PassengerEligibility {
  canGoOnline: boolean;
  reasons: string[];
}

/**
 * One row of `GET /passenger/driver/trips`. With no `status` query param,
 * only ASSIGNED and IN_PROGRESS come back, as a bare array (today's My
 * Departures shape, unchanged). Passing `status` (e.g. `COMPLETED` for trip
 * history, MDF-554) switches the same endpoint to a different, explicit,
 * paginated query -- see `DriverTripHistory` below. `completedAt` is null on
 * an active trip, set once `complete` is called.
 */
export interface PassengerTrip {
  id: string;
  reference: string;
  status: string;
  scheduledDepartureAt: string;
  completedAt: string | null;
  routeName: string | null;
  from: string | null;
  to: string | null;
  operator: string | null;
  seatCapacity: number | null;
}

/** The paginated shape `GET /passenger/driver/trips?status=...` returns -- real pagination, not a raised cap, since history grows without bound. */
export interface DriverTripHistory {
  rows: PassengerTrip[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One end of a booking's pickup/drop-off (MDF-549, MDF-548's
 * `GET /passenger/driver/trips/:id/bookings`). Null, not absent, when that
 * end was never pinned — the feature is optional per booking, so null is the
 * normal case on a scheduled route, not missing data (god's ruling, same
 * reasoning as admin's no-`emptyHint` call).
 */
export interface TripBookingLocation {
  district: string | null;
  city: string | null;
  address: string | null;
  landmark: string | null;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * One row of `GET /passenger/driver/trips/:id/bookings`. Deliberately no
 * `passengerName` and no phone — god's ruling, asserted in Pam's own test: a
 * driver card must not need a rider's name. A trip the caller is not
 * assigned to returns 200 with an empty array, not 404 — an empty list is
 * the normal "nothing to show" case, not an error.
 *
 * Shape transcribed from god's report of Pam's MDF-548 branch
 * (`feat/passenger-api-booking-pins`), not yet read directly — verify
 * against that branch once it is pushed.
 */
export interface TripBooking {
  id: string;
  reference: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
  seats: number;
  isTest: boolean;
  tripId: string;
  tripReference: string | null;
  tripStatus: string | null;
  scheduledDepartureAt: string | null;
  routeName: string | null;
  from: string | null;
  to: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  pickup: TripBookingLocation | null;
  dropoff: TripBookingLocation | null;
}

/** What a human reads for one end — street if given, else the landmark, else just town/district. */
export function tripBookingEndLine(end: TripBookingLocation | null): string {
  if (!end) return 'Not specified — travelling to/from the route’s own stop';
  if (end.address) return [end.address, end.city, end.district].filter(Boolean).join(', ');
  if (end.landmark) return [end.landmark, end.city, end.district].filter(Boolean).join(', ');
  if (end.city || end.district) return [end.city, end.district].filter(Boolean).join(', ');
  return 'Not specified — travelling to/from the route’s own stop';
}

/**
 * The availability states a driver may set — exactly the server's
 * DRIVER_SETTABLE_AVAILABILITY, hinted for passenger work. SUSPENDED is a
 * fourth server state a driver cannot set and is never offered as a button.
 */
export const PASSENGER_AVAILABILITY_OPTIONS: Array<{
  value: (typeof DRIVER_SETTABLE_AVAILABILITY)[number];
  label: string;
  hint: string;
}> = [
  { value: 'ONLINE', label: 'Online', hint: 'Available to be assigned departures' },
  { value: 'UNAVAILABLE', label: 'Unavailable', hint: 'On a break — keep me off new departures' },
  { value: 'OFFLINE', label: 'Offline', hint: 'Off shift' },
];

/**
 * Which movement button a trip row shows. Presentation only — the transitions
 * (ASSIGNED → start, IN_PROGRESS → complete) are enforced by the server, whose
 * refusal is shown verbatim if this mapping is ever out of date. There is no
 * en-route state on purpose: that is the on-demand taxi shape, a later slice.
 */
export function tripAction(status: string): { action: 'start' | 'complete'; label: string } | null {
  if (status === 'ASSIGNED') return { action: 'start', label: 'Start trip' };
  if (status === 'IN_PROGRESS') return { action: 'complete', label: 'Complete trip' };
  return null;
}

export type AvailabilityTone = 'success' | 'warning' | 'error' | 'neutral';

export function availabilityTone(availability: PassengerAvailability): AvailabilityTone {
  switch (availability) {
    case 'ONLINE':
      return 'success';
    case 'UNAVAILABLE':
      return 'warning';
    case 'SUSPENDED':
      return 'error';
    default:
      return 'neutral';
  }
}
