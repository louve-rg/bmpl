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

/** One row of `GET /passenger/driver/trips` — only ASSIGNED and IN_PROGRESS come back. */
export interface PassengerTrip {
  id: string;
  reference: string;
  status: string;
  scheduledDepartureAt: string;
  routeName: string | null;
  from: string | null;
  to: string | null;
  operator: string | null;
  seatCapacity: number | null;
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
