import { z } from 'zod';
import {
  HUB_TYPES,
  isWithinBelize,
  LEG_KINDS,
  OUT_OF_BOUNDS_MESSAGE,
  SHIPPING_SERVICES,
  TRANSPORT_MODES,
} from '@bmpl/shared';
import { cuidSchema, districtSchema, phoneSchema } from './common';

/**
 * Multi-leg shipping input.
 *
 * The network (hubs and routes) is configured by operations, so those schemas
 * are admin-facing and strict. The booking schema is customer-facing and applies
 * the same coordinate rules the rest of the app already enforces — a pin is both
 * coordinates or neither, and it has to be in Belize.
 */

/* ------------------------------------------------------------- the network */

const coordinates = {
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
};

/** Both-or-neither, and inside Belize. Shared by every schema that takes a pin. */
const withPinRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((v: { latitude?: number | null; longitude?: number | null }) => (v.latitude == null) === (v.longitude == null), {
      message: 'A pinned location needs both a latitude and a longitude.',
      path: ['latitude'],
    })
    .refine((v: { latitude?: number | null; longitude?: number | null }) => v.latitude == null || isWithinBelize(v.latitude, v.longitude), {
      message: OUT_OF_BOUNDS_MESSAGE,
      path: ['latitude'],
    });

const hubBase = z.object({
  // Uppercased on the way in: the code is an operator handle and a planner
  // tie-break, and "spw" and "SPW" being two hubs would be a quiet disaster.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'A hub code needs at least 2 characters.')
    .max(12)
    .regex(/^[A-Z0-9-]+$/, 'A hub code may only contain letters, numbers and hyphens.'),
  name: z.string().trim().min(2).max(120),
  type: z.enum(HUB_TYPES),
  district: districtSchema,
  city: z.string().trim().min(2).max(80),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  ...coordinates,
  // At least one, or the hub can never appear in a plan.
  modes: z.array(z.enum(TRANSPORT_MODES)).min(1, 'A hub has to handle at least one mode of transport.'),
  instructions: z.string().trim().max(1000).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: phoneSchema.optional(),
  isActive: z.boolean().optional(),
});

export const createHubSchema = withPinRules(hubBase);
export const updateHubSchema = withPinRules(
  hubBase.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' }),
);
export type CreateHubInput = z.infer<typeof createHubSchema>;
export type UpdateHubInput = z.infer<typeof updateHubSchema>;

const routeBase = z.object({
  originHubId: cuidSchema,
  destinationHubId: cuidSchema,
  mode: z.enum(TRANSPORT_MODES),
  carrierName: z.string().trim().max(120).optional(),
  carrierPhone: phoneSchema.optional(),
  scheduleNote: z.string().trim().max(200).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(60 * 24 * 7),
  priceMinor: z.coerce.number().int().min(0).max(100_000_000),
  isActive: z.boolean().optional(),
});

/** A route from a hub to itself would let the planner loop for free. */
const notSelfReferential = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (v: { originHubId?: string; destinationHubId?: string }) =>
      v.originHubId == null || v.destinationHubId == null || v.originHubId !== v.destinationHubId,
    { message: 'A route has to go between two different hubs.', path: ['destinationHubId'] },
  );

export const createRouteSchema = notSelfReferential(routeBase);
export const updateRouteSchema = notSelfReferential(
  routeBase.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' }),
);
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/* --------------------------------------------------------------- quoting */

/**
 * One end of a journey: either an address we collect from / deliver to, or a
 * terminal the customer handles themselves. Which one is required is decided by
 * the service type, checked in `endpointsMatchService` below.
 */
const endpointSchema = withPinRules(
  z.object({
    hubId: cuidSchema.optional(),
    name: z.string().trim().max(120).optional(),
    phone: phoneSchema.optional(),
    address: z.string().trim().max(200).optional(),
    city: z.string().trim().max(80).optional(),
    district: districtSchema.optional(),
    instructions: z.string().trim().max(1000).optional(),
    ...coordinates,
  }),
);

const quoteBase = z.object({
  service: z.enum(SHIPPING_SERVICES),
  origin: endpointSchema,
  destination: endpointSchema,
  preferredMode: z.enum(TRANSPORT_MODES).optional(),
  weightGrams: z.coerce.number().int().min(1).max(2_000_000).optional(),
  pieces: z.coerce.number().int().min(1).max(500).default(1),
  description: z.string().trim().max(500).optional(),
});

type QuoteShape = z.infer<typeof quoteBase>;

/**
 * A door end needs a district (that is how the planner attaches it to a hub); a
 * hub end needs a hub. Checking it here means the planner is never handed an
 * endpoint it cannot resolve, and the customer gets the error against the field
 * they can actually fix.
 *
 * Typed on the PARSED value rather than the schema: `pieces` has a default, so
 * the schema's input and output types differ and a `ZodType<QuoteShape>` bound
 * would only match one of them.
 */
const endpointsMatchService = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((v: QuoteShape) => (v.service === 'DOOR_TO_DOOR' || v.service === 'DOOR_TO_HUB' ? !!v.origin.district : !!v.origin.hubId), {
      message: 'Tell us where to collect from: a district for a door collection, or a terminal.',
      path: ['origin'],
    })
    .refine(
      (v: QuoteShape) =>
        v.service === 'DOOR_TO_DOOR' || v.service === 'HUB_TO_DOOR' ? !!v.destination.district : !!v.destination.hubId,
      {
        message: 'Tell us where it is going: a district for a door delivery, or a terminal.',
        path: ['destination'],
      },
    );

export const shipmentQuoteSchema = endpointsMatchService(quoteBase);
// Stated rather than inferred: the refinement helper is generic over ZodTypeAny
// (see above), so `z.infer` on its result widens to `any`. Refinements never
// change the parsed shape, so the base schema's type IS the type.
export type ShipmentQuoteInput = QuoteShape;

/** Booking is a quote plus the contact details we only need once it is real. */
export const createShipmentSchema = endpointsMatchService(quoteBase)
  .refine((v: QuoteShape) => v.service === 'HUB_TO_HUB' || v.service === 'HUB_TO_DOOR' || !!v.origin.address, {
    message: 'We need the address to collect from.',
    path: ['origin', 'address'],
  })
  .refine((v: QuoteShape) => v.service === 'HUB_TO_HUB' || v.service === 'DOOR_TO_HUB' || !!v.destination.address, {
    message: 'We need the address to deliver to.',
    path: ['destination', 'address'],
  })
  .refine((v: QuoteShape) => !!v.destination.name && !!v.destination.phone, {
    // Somebody has to be reachable at the far end, whether a driver is knocking
    // on their door or they are collecting from a counter.
    message: 'We need a name and phone number for whoever is receiving this.',
    path: ['destination', 'name'],
  });
export type CreateShipmentInput = QuoteShape;

/* ------------------------------------------------------- operating a leg */

/** Confirming a line-haul departed. */
export const legDepartSchema = z.object({
  carrierName: z.string().trim().max(120).optional(),
  carrierBookingRef: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type LegDepartInput = z.infer<typeof legDepartSchema>;

/**
 * Confirming a leg's handoff. The PIN is what the RECEIVER holds, so whoever is
 * handing over has to produce it — the same shape as the delivery PIN that
 * already works.
 */
export const legHandoffSchema = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the handoff code.'),
  receivedByName: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
  ...coordinates,
});
export type LegHandoffInput = z.infer<typeof legHandoffSchema>;

/** An operator recording that something went wrong on a leg. */
export const legExceptionSchema = z.object({
  reason: z.string().trim().min(4, 'Say what happened.').max(500),
});
export type LegExceptionInput = z.infer<typeof legExceptionSchema>;

/** Recording that a recipient collected their parcel from a terminal. */
export const collectShipmentSchema = z.object({
  collectedByName: z.string().trim().min(2, 'Who collected it?').max(120),
});
export type CollectShipmentInput = z.infer<typeof collectShipmentSchema>;

export const cancelShipmentSchema = z.object({
  reason: z.string().trim().min(4, 'Say why it is being cancelled.').max(500),
});
export type CancelShipmentInput = z.infer<typeof cancelShipmentSchema>;

/**
 * A query-string boolean that respects the word "false".
 *
 * `z.coerce.boolean()` runs JavaScript's Boolean(), and Boolean('false') is
 * TRUE — so `?includeTest=false` would have done the opposite of what it says.
 * On a filter that decides whether simulation shipments appear on an operations
 * board, that is the wrong direction to fail in.
 */
const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .or(z.boolean());

/** Admin listing filters. */
export const shipmentListSchema = z.object({
  status: z.string().trim().max(40).optional(),
  service: z.enum(SHIPPING_SERVICES).optional(),
  includeTest: queryBoolean.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ShipmentListInput = z.infer<typeof shipmentListSchema>;

export const legKindSchema = z.enum(LEG_KINDS);
