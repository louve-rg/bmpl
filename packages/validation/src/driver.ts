import { z } from 'zod';
import {
  DISTRICTS,
  DRIVER_SETTABLE_AVAILABILITY,
  VEHICLE_OWNERSHIP,
  VEHICLE_TYPES,
} from '@bmpl/shared';

const cuid = z.string().cuid2().or(z.string().cuid());
const district = z.enum(DISTRICTS);
const phone = z.string().trim().min(5).max(40);
const storageKey = z.string().trim().min(1).max(512);

/** Driver profile / application data (create or update; owner-scoped). */
export const driverProfileSchema = z.object({
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
  vehicleOwnership: z.enum(VEHICLE_OWNERSHIP),
  termsAccepted: z.boolean(),
  applicantNotes: z.string().trim().max(1000).optional(),
  profilePhotoKey: storageKey.optional(),
});
export type DriverProfileInput = z.infer<typeof driverProfileSchema>;

export const driverProfileUpdateSchema = driverProfileSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type DriverProfileUpdateInput = z.infer<typeof driverProfileUpdateSchema>;

/** A driver vehicle (normalized; no JSON blobs for core fields). */
export const driverVehicleSchema = z.object({
  type: z.enum(VEHICLE_TYPES),
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
  photoKeys: z.array(storageKey).max(8).optional(),
  isPrimary: z.boolean().optional(),
});
export type DriverVehicleInput = z.infer<typeof driverVehicleSchema>;

export const driverVehicleUpdateSchema = driverVehicleSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type DriverVehicleUpdateInput = z.infer<typeof driverVehicleUpdateSchema>;

/** Driver's declared service districts (replaces the current set). */
export const driverServiceAreasSchema = z.object({
  districts: z.array(district).max(6),
});
export type DriverServiceAreasInput = z.infer<typeof driverServiceAreasSchema>;

/** Narrows one already-served district down to specific towns/cities (replaces
 *  the current set for that district; empty list widens back to the whole
 *  district). Free text, matching the convention `LogisticsHub.city` already
 *  uses — never a fabricated or enumerated place list. */
export const driverServiceCitiesSchema = z.object({
  cities: z.array(z.string().trim().min(1).max(120)).max(50),
});
export type DriverServiceCitiesInput = z.infer<typeof driverServiceCitiesSchema>;

/** Availability change (driver may set OFFLINE/ONLINE/UNAVAILABLE; SUSPENDED is admin-only). */
export const driverAvailabilitySchema = z.object({
  availability: z.enum(DRIVER_SETTABLE_AVAILABILITY),
});
export type DriverAvailabilityInput = z.infer<typeof driverAvailabilitySchema>;

/** Admin vehicle moderation. */
export const vehicleModerationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type VehicleModerationInput = z.infer<typeof vehicleModerationSchema>;
