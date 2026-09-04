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
