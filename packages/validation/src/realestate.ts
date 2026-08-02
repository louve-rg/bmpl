import { z } from 'zod';
import {
  DISTRICTS,
  LISTING_PURPOSES,
  PROPERTY_TYPES,
  FURNISHINGS,
  TENURES,
  LOCATION_VISIBILITIES,
  RENTAL_PERIODS,
  AREA_UNITS,
  AGENT_SPECIALTIES,
  PROPERTY_DOCUMENT_KINDS,
  PROPERTY_ENQUIRY_TYPES,
  VIEWING_REQUEST_STATUSES,
  PROPERTY_REPORT_REASONS,
} from '@bmpl/shared';

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const clean = (s: string) => s.replace(CONTROL, '').trim();
const text = (min: number, max: number) => z.string().transform(clean).pipe(z.string().min(min).max(max));
const optText = (max: number) => z.string().transform(clean).pipe(z.string().max(max)).transform((s) => (s === '' ? null : s)).nullable().optional();
const cuid = z.string().cuid2().or(z.string().cuid());
const district = z.enum(DISTRICTS);
const moneyMinor = z.coerce.number().int().min(0).max(100_000_000_000);
const count = z.coerce.number().int().min(0).max(1000);
const area = z.coerce.number().min(0).max(100_000_000);

// ===========================================================================
// Profiles
// ===========================================================================
export const upsertPropertyOwnerProfileSchema = z.object({
  legalName: text(2, 160),
  displayName: optText(120),
  phone: optText(40),
  email: z.string().email().max(200).nullable().optional(),
  district: district.nullable().optional(),
  contactPreference: z.enum(['EMAIL', 'PHONE', 'MESSAGE']).nullable().optional(),
});
export type UpsertPropertyOwnerProfileInput = z.infer<typeof upsertPropertyOwnerProfileSchema>;

export const upsertAgentProfileSchema = z.object({
  displayName: text(2, 160),
  legalName: optText(160),
  bio: optText(4000),
  phone: optText(40),
  email: z.string().email().max(200).nullable().optional(),
  website: z.string().trim().url().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  serviceDistricts: z.array(district).max(6).optional(),
  specialties: z.array(z.enum(AGENT_SPECIALTIES)).max(8).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(80).nullable().optional(),
});
export type UpsertAgentProfileInput = z.infer<typeof upsertAgentProfileSchema>;

export const upsertAgencyProfileSchema = z.object({
  name: text(2, 160),
  legalName: optText(200),
  description: optText(4000),
  contactEmail: z.string().email().max(200),
  contactPhone: optText(40),
  website: z.string().trim().url().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  district: district.nullable().optional(),
  addressLine1: optText(200),
  city: optText(120),
});
export type UpsertAgencyProfileInput = z.infer<typeof upsertAgencyProfileSchema>;

// ===========================================================================
// Listings
// ===========================================================================
const listingCore = {
  purpose: z.enum(LISTING_PURPOSES),
  propertyType: z.enum(PROPERTY_TYPES),
  title: text(4, 180),
  description: text(20, 16000),
  priceMinor: moneyMinor,
  rentalPeriod: z.enum(RENTAL_PERIODS).nullable().optional(),
  negotiable: z.boolean().optional(),
  district: district.nullable().optional(),
  locality: optText(160),
  generalAddress: optText(300),
  exactAddress: optText(300),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  locationVisibility: z.enum(LOCATION_VISIBILITIES).optional(),
  bedrooms: count.nullable().optional(),
  bathrooms: count.nullable().optional(),
  halfBathrooms: count.nullable().optional(),
  parkingSpaces: count.nullable().optional(),
  propertySize: area.nullable().optional(),
  landSize: area.nullable().optional(),
  areaUnit: z.enum(AREA_UNITS).nullable().optional(),
  yearBuilt: z.coerce.number().int().min(1800).max(2100).nullable().optional(),
  furnishing: z.enum(FURNISHINGS).nullable().optional(),
  tenure: z.enum(TENURES).nullable().optional(),
  petPolicy: optText(200),
  availabilityDate: z.coerce.date().nullable().optional(),
  leaseTerm: optText(200),
  condition: optText(200),
  videoUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
  amenities: z.array(text(1, 80)).max(50).optional(),
  utilities: z.array(text(1, 80)).max(30).optional(),
};
/** For a rental, a rental period is required. */
const rentalRefine = (v: { purpose?: string; rentalPeriod?: unknown }) => v.purpose !== 'FOR_RENT' || !!v.rentalPeriod;
export const createPropertySchema = z.object(listingCore).refine(rentalRefine, { message: 'A rental listing needs a rental period.', path: ['rentalPeriod'] });
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export const updatePropertySchema = z.object(listingCore).partial().refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

/** Admin moderation actions on a listing. */
export const propertyModerateSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO', 'UNPUBLISH', 'SUSPEND', 'RESTORE', 'ARCHIVE']),
  reason: optText(1000),
});
export type PropertyModerateInput = z.infer<typeof propertyModerateSchema>;

/** Owner-driven status changes (withdraw / under-offer / sold / rented). */
export const propertyOwnerStatusSchema = z.object({
  action: z.enum(['WITHDRAW', 'UNDER_OFFER', 'SOLD', 'RENTED', 'ARCHIVE']),
});
export type PropertyOwnerStatusInput = z.infer<typeof propertyOwnerStatusSchema>;

export const propertyImageConfirmSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  altText: optText(200),
  caption: optText(300),
  areaLabel: optText(60),
});
export type PropertyImageConfirmInput = z.infer<typeof propertyImageConfirmSchema>;

export const propertyDocumentConfirmSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  kind: z.enum(PROPERTY_DOCUMENT_KINDS),
  label: optText(160),
});
export type PropertyDocumentConfirmInput = z.infer<typeof propertyDocumentConfirmSchema>;

/** Owner assigns an approved agent to manage a listing. */
export const assignAgentSchema = z.object({ agentProfileId: cuid, authorizationDocId: cuid.nullable().optional() });
export type AssignAgentInput = z.infer<typeof assignAgentSchema>;

// ===========================================================================
// Enquiries / viewing requests / reports
// ===========================================================================
export const createEnquirySchema = z.object({
  listingId: cuid,
  type: z.enum(PROPERTY_ENQUIRY_TYPES).optional(),
  message: text(2, 4000),
  preferredContact: z.enum(['EMAIL', 'PHONE', 'MESSAGE']).nullable().optional(),
  contactPhone: optText(40),
});
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const enquiryReplySchema = z.object({ message: text(1, 4000) });
export type EnquiryReplyInput = z.infer<typeof enquiryReplySchema>;

export const createViewingRequestSchema = z.object({
  listingId: cuid,
  requestedDate: z.coerce.date(),
  requestedTime: optText(40),
  timezone: z.string().trim().max(64).optional(),
  alternateDate: z.coerce.date().nullable().optional(),
  alternateTime: optText(40),
  message: optText(2000),
});
export type CreateViewingRequestInput = z.infer<typeof createViewingRequestSchema>;

/** Owner/agent (or requester cancel) viewing transition — validated against the map. */
export const viewingTransitionSchema = z.object({
  status: z.enum(VIEWING_REQUEST_STATUSES),
  confirmedDate: z.coerce.date().nullable().optional(),
  confirmedTime: optText(40),
  note: optText(1000),
  cancellationReason: optText(1000),
});
export type ViewingTransitionInput = z.infer<typeof viewingTransitionSchema>;

export const propertyReportSchema = z.object({ reason: z.enum(PROPERTY_REPORT_REASONS), note: optText(1000) });
export type PropertyReportInput = z.infer<typeof propertyReportSchema>;

export const resolvePropertyReportSchema = z.object({ status: z.enum(['ACTIONED', 'DISMISSED']), note: optText(1000) });
export type ResolvePropertyReportInput = z.infer<typeof resolvePropertyReportSchema>;
