import { z } from 'zod';
import { DISTRICTS, DRIVER_SETTABLE_AVAILABILITY, MAX_PASSENGER_SEATS, PASSENGER_VEHICLE_TYPES } from '@bmpl/shared';

/**
 * Passenger transportation — supply side (S1).
 *
 * The shapes mirror the delivery driver's schemas deliberately, because the
 * jobs rhyme; the vocabulary differs where the domains genuinely differ
 * (PassengerVehicleType, seatCapacity). Two things are deliberately ABSENT:
 * photo/storage keys (no passenger upload surface exists yet, and accepting a
 * client-supplied key without one is how a signed-URL leak starts), and any
 * isTest field — the simulation flag is admin-set only, never taken from a
 * request, on every model in this system.
 */

const district = z.enum(DISTRICTS);
const phone = z.string().trim().min(5).max(40);

/** Passenger-driver profile / application data (owner-scoped upsert). */
export const passengerDriverProfileSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal name is required.').max(160),
  displayName: z.string().trim().min(1, 'Display name is required.').max(80),
  phone,
  homeDistrict: district,
  homeAddress: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  emergencyContactName: z.string().trim().max(160).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
  licenceNumber: z.string().trim().min(1, "Driver's licence number is required.").max(60),
  licenceExpiry: z.coerce.date(),
  termsAccepted: z.boolean(),
  applicantNotes: z.string().trim().max(1000).optional(),
});
export type PassengerDriverProfileInput = z.infer<typeof passengerDriverProfileSchema>;

export const passengerDriverProfileUpdateSchema = passengerDriverProfileSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type PassengerDriverProfileUpdateInput = z.infer<typeof passengerDriverProfileUpdateSchema>;

/** Passenger-provider (fleet operator) profile (owner-scoped upsert). */
export const passengerProviderProfileSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(160),
  description: z.string().trim().max(2000).optional(),
  contactEmail: z.string().trim().email('A valid contact email is required.').max(320),
  contactPhone: z.string().trim().max(40).optional(),
  district: district.optional(),
  city: z.string().trim().max(120).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  operatingLicenceNumber: z.string().trim().max(60).optional(),
  operatingLicenceExpiry: z.coerce.date().optional(),
});
export type PassengerProviderProfileInput = z.infer<typeof passengerProviderProfileSchema>;

export const passengerProviderProfileUpdateSchema = passengerProviderProfileSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type PassengerProviderProfileUpdateInput = z.infer<typeof passengerProviderProfileUpdateSchema>;

/**
 * A passenger vehicle. `seatCapacity` is the point of the model — seats
 * available to sell, excluding the driver — and is required at registration:
 * a passenger vehicle with unknown capacity can never take a booking.
 */
export const passengerVehicleSchema = z.object({
  type: z.enum(PASSENGER_VEHICLE_TYPES),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  color: z.string().trim().max(40).optional(),
  licencePlate: z.string().trim().min(1).max(20),
  registrationNumber: z.string().trim().max(60).optional(),
  registrationExpiry: z.coerce.date().optional(),
  insuranceProvider: z.string().trim().max(120).optional(),
  insurancePolicyNumber: z.string().trim().max(80).optional(),
  insuranceExpiry: z.coerce.date().optional(),
  seatCapacity: z.coerce.number().int().min(1, 'At least one passenger seat.').max(MAX_PASSENGER_SEATS),
  isPrimary: z.boolean().optional(),
});
export type PassengerVehicleInput = z.infer<typeof passengerVehicleSchema>;

export const passengerVehicleUpdateSchema = passengerVehicleSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type PassengerVehicleUpdateInput = z.infer<typeof passengerVehicleUpdateSchema>;

/** Availability change (driver may set OFFLINE/ONLINE/UNAVAILABLE; SUSPENDED is admin-only). */
export const passengerAvailabilitySchema = z.object({
  availability: z.enum(DRIVER_SETTABLE_AVAILABILITY),
});
export type PassengerAvailabilityInput = z.infer<typeof passengerAvailabilitySchema>;

/**
 * Passenger transportation — network structure (S2).
 *
 * A route is an operator-entered fact about Belize: which towns their service
 * connects, in what order. Nothing here is derived or defaulted from
 * geography. Two fields are deliberately ABSENT from every schema below:
 * `isTest` (derived from the owning operator's profile — a route can never sit
 * on the other side of the simulation boundary from the operator who runs it)
 * and `baseFareMinor` (no fare policy exists; the column stays null until the
 * product owner rules on pricing, and no request may set it).
 */

/** An intermediate stop. Order comes from array position — a client never numbers stops itself. */
export const passengerRouteStopSchema = z.object({
  district,
  city: z.string().trim().min(1, 'Every stop names its town.').max(120),
  name: z.string().trim().max(120).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});
export type PassengerRouteStopInput = z.infer<typeof passengerRouteStopSchema>;

export const passengerRouteStopsSchema = z.array(passengerRouteStopSchema).max(50);
export type PassengerRouteStopsInput = z.infer<typeof passengerRouteStopsSchema>;

export const passengerRouteSchema = z.object({
  name: z.string().trim().min(1, 'Name the service.').max(120),
  description: z.string().trim().max(2000).optional(),
  originDistrict: district,
  originCity: z.string().trim().min(1, 'The origin town is required.').max(120),
  destinationDistrict: district,
  destinationCity: z.string().trim().min(1, 'The destination town is required.').max(120),
  /** A label the operator writes ("Mon–Sat 06:30"), reported verbatim — not a calendar. */
  scheduleNote: z.string().trim().max(200).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  /**
   * The operator's configured fare, BZD minor units, stored VERBATIM (S3, per
   * the product owner's fare ruling: booking requires a configured fare).
   * Zero means "not priced yet" and keeps the booking gate closed, exactly as
   * a zero hub fee keeps a journey unbookable. Nothing anywhere computes,
   * multiplies or charges with this number — whether it is per seat or per
   * booking is commercial policy nobody has set.
   */
  baseFareMinor: z.coerce.number().int().min(0).max(100_000_000).optional(),
  stops: passengerRouteStopsSchema.optional(),
});
export type PassengerRouteInput = z.infer<typeof passengerRouteSchema>;

export const passengerRouteUpdateSchema = passengerRouteSchema
  .omit({ stops: true })
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type PassengerRouteUpdateInput = z.infer<typeof passengerRouteUpdateSchema>;

/** Admin-side creation names the operator the route belongs to; everything else is identical. */
export const adminPassengerRouteSchema = passengerRouteSchema.extend({
  providerProfileId: z.string().trim().min(1),
});
export type AdminPassengerRouteInput = z.infer<typeof adminPassengerRouteSchema>;

/** One departure of a configured route. Assignment of a driver/vehicle is a later phase. */
export const passengerTripCreateSchema = z
  .object({
    routeId: z.string().trim().min(1),
    scheduledDepartureAt: z.coerce.date(),
    scheduledArrivalAt: z.coerce.date().optional(),
  })
  .refine((v) => !v.scheduledArrivalAt || v.scheduledArrivalAt > v.scheduledDepartureAt, {
    message: 'Arrival must be after departure.',
    path: ['scheduledArrivalAt'],
  });
export type PassengerTripCreateInput = z.infer<typeof passengerTripCreateSchema>;

export const passengerTripCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type PassengerTripCancelInput = z.infer<typeof passengerTripCancelSchema>;

/**
 * Passenger transportation — booking & movement (S3).
 *
 * Note what is absent, again: no isTest (derived from the rider's account),
 * no fare fields of any kind (the fare GATE checks a configured fare exists;
 * nothing computes, quotes or charges an amount — fareQuotedMinor stays null
 * until a pricing policy exists), and no NO_SHOW / on-demand shapes (their
 * product questions are unanswered).
 */

/** Book seats on a published SCHEDULED departure. */
export const passengerBookingCreateSchema = z.object({
  tripId: z.string().trim().min(1),
  seats: z.coerce.number().int().min(1, 'At least one seat.').max(MAX_PASSENGER_SEATS),
});
export type PassengerBookingCreateInput = z.infer<typeof passengerBookingCreateSchema>;

export const passengerBookingCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type PassengerBookingCancelInput = z.infer<typeof passengerBookingCancelSchema>;

/** Manual staffing of a departure: a named driver and a named vehicle, always. */
export const passengerTripAssignSchema = z.object({
  driverProfileId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
});
export type PassengerTripAssignInput = z.infer<typeof passengerTripAssignSchema>;
