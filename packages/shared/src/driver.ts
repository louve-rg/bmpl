/**
 * Driver Management (Phase 4 · M14) shared constants + helpers. Framework-agnostic;
 * consumed by the API, web, admin, and (future) mobile. Approval of the driver
 * ROLE is handled by the existing role-application system (DELIVERY_DRIVER); these
 * cover the driver's operational profile, vehicles, service areas, and availability.
 */

/** Driver availability. SUSPENDED is set by admin (via role suspension); the driver
 *  toggles OFFLINE/ONLINE/UNAVAILABLE. ONLINE is gated by eligibility (see API). */
export const DRIVER_AVAILABILITY = ['OFFLINE', 'ONLINE', 'UNAVAILABLE', 'SUSPENDED'] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[number];

/** States a driver may set themselves (SUSPENDED is admin-only). */
export const DRIVER_SETTABLE_AVAILABILITY = ['OFFLINE', 'ONLINE', 'UNAVAILABLE'] as const;
export type DriverSettableAvailability = (typeof DRIVER_SETTABLE_AVAILABILITY)[number];

export const VEHICLE_TYPES = ['CAR', 'MOTORCYCLE', 'SCOOTER', 'BICYCLE', 'VAN', 'TRUCK', 'OTHER'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_OWNERSHIP = ['OWNED', 'LEASED', 'BORROWED', 'NONE'] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIP)[number];

export const VEHICLE_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VehicleApprovalStatus = (typeof VEHICLE_APPROVAL_STATUSES)[number];

/** A document/vehicle within this many days of expiry is "expiring soon". */
export const DOCUMENT_EXPIRY_SOON_DAYS = 30;

export type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

/** Classify an expiry date relative to `now`. Returns null when no date is set. */
export function expiryStatus(expiry: Date | string | null | undefined, now: Date = new Date()): ExpiryStatus | null {
  if (!expiry) return null;
  const when = typeof expiry === 'string' ? new Date(expiry) : expiry;
  const ms = when.getTime() - now.getTime();
  if (ms <= 0) return 'EXPIRED';
  if (ms <= DOCUMENT_EXPIRY_SOON_DAYS * 24 * 60 * 60 * 1000) return 'EXPIRING_SOON';
  return 'VALID';
}

/** True when the expiry is missing or in the past (blocks going ONLINE). */
export const isExpiredOrMissing = (expiry: Date | string | null | undefined, now: Date = new Date()): boolean => {
  const s = expiryStatus(expiry, now);
  return s === null || s === 'EXPIRED';
};
