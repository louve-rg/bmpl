/**
 * Passenger-operator surface: response shapes and presentation rules for the
 * fleet operator's self-service pages. Plain data, no React, so the rules are
 * testable without a renderer. Every mapping here is a presentation-only
 * mirror of a server rule — the server is the authority, and its refusals are
 * shown verbatim wherever these mappings are out of date.
 */

export interface OperatorProfile {
  id: string;
  businessName: string;
  description?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  district?: string | null;
  city?: string | null;
  addressLine1?: string | null;
  operatingLicenceNumber?: string | null;
  operatingLicenceExpiry?: string | null;
  operatingLicenceExpiryStatus?: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  isActive: boolean;
  isTest: boolean;
}

export interface OperatorRouteStop {
  id: string;
  sequence: number;
  district: string;
  city: string;
  name?: string | null;
}

export interface OperatorRoute {
  id: string;
  name: string;
  description?: string | null;
  originDistrict: string;
  originCity: string;
  destinationDistrict: string;
  destinationCity: string;
  scheduleNote?: string | null;
  durationMinutes?: number | null;
  baseFareMinor: number | null;
  isActive: boolean;
  isTest: boolean;
  stops?: OperatorRouteStop[];
  tripCount?: number;
}

export interface OperatorTrip {
  id: string;
  reference: string;
  status: string;
  routeId: string | null;
  routeName: string | null;
  driverProfileId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehicle: { make: string; model: string; licencePlate: string } | null;
  seatCapacity: number | null;
  seatsConfirmed?: number;
  seatsRemaining?: number | null;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt?: string | null;
  cancellationReason?: string | null;
}

export interface OperatorBooking {
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
  passengerName?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
}

/**
 * The fare gate's own definition (passenger-operations.service.ts `fareGate`):
 * zero is not a price and null is not a price. A route failing this cannot
 * take or confirm a booking, and the UI says so instead of letting riders
 * discover it. Nothing anywhere multiplies this number — whether it is per
 * seat or per booking is commercial policy nobody has set.
 */
export function isFareConfigured(baseFareMinor: number | null | undefined): boolean {
  return baseFareMinor != null && baseFareMinor > 0;
}

/** BZD minor units → display string, verbatim amount, no invented unit. */
export function formatBzd(minor: number): string {
  return `BZ$${(minor / 100).toFixed(2)}`;
}

/**
 * Which answer buttons a booking row offers the operator. Mirrors the server:
 * only a REQUESTED booking can be confirmed, and only a REQUESTED or
 * CONFIRMED one cancelled — anything else is already settled.
 */
export function bookingActions(status: string): Array<'confirm' | 'cancel'> {
  if (status === 'REQUESTED') return ['confirm', 'cancel'];
  if (status === 'CONFIRMED') return ['cancel'];
  return [];
}

/**
 * Whether a departure can still be cancelled. Mirrors the server: a departure
 * that has not begun (SCHEDULED or ASSIGNED) is normal ops to cancel;
 * anything in progress or later is people on a vehicle.
 */
export function tripCancellable(status: string): boolean {
  return status === 'SCHEDULED' || status === 'ASSIGNED';
}
