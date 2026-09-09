import { z } from 'zod';
import {
  HUB_TYPES,
  isWithinBelize,
  LEG_KINDS,
  OUT_OF_BOUNDS_MESSAGE,
  needsFirstMile,
  needsLastMile,
  SHIPPING_SERVICES,
  TRANSPORT_MODES,
  UNLOCATABLE_ADDRESS_MESSAGE,
} from '@bmpl/shared';
import { cuidSchema, districtSchema, isLocatable, phoneSchema } from './common';

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
  // What BML charges for the courier run between this terminal and a door in
  // its town, in minor units. 0 is allowed and MEANS "not priced yet" — the
  // quote flags it and, since the zero-total rule, booking refuses it. This
  // field was missing entirely, which meant the admin Terminals screen's
  // "Courier rate" control was stripped to nothing by this very schema and no
  // hub could EVER be priced through the product.
  courierFeeMinor: z.coerce.number().int().min(0).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
  // Simulation infrastructure, exactly as courier lanes already accept: this
  // endpoint is admin-only (logistics.manage), so the flag is admin-set, never
  // an ordinary client's assertion. Without it, nothing an admin builds in the
  // console could ever serve a test customer.
  isTest: z.boolean().optional(),
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
  // Admin-set simulation flag, consistent with hubs and courier lanes.
  isTest: z.boolean().optional(),
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

/* -------------------------------------------------------- courier lanes */

/**
 * Two towns one courier can drive between.
 *
 * Operator-facing and strict, like the rest of the network. The one rule that
 * is not obvious is that a lane must connect two DIFFERENT towns: a town is
 * already local to itself, so a self-lane is a row that changes no answer.
 * That check needs both ends, so it lives on the object rather than a field.
 */
const courierLaneBase = z.object({
  originDistrict: districtSchema,
  originCity: z.string().trim().min(2, 'Name the town we collect from.').max(80),
  destinationDistrict: districtSchema,
  destinationCity: z.string().trim().min(2, 'Name the town we deliver to.').max(80),
  // Minor units. 0 is allowed and MEANS "not priced yet" — a quote says so
  // out loud rather than quietly shipping for free.
  priceMinor: z.coerce.number().int().min(0).max(100_000_000).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(60 * 24).optional(),
  note: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  isTest: z.boolean().optional(),
});

/**
 * Typed on the PARSED value, the same way the endpoint refinements above are:
 * the base schema has optional fields, so create and update parse to different
 * shapes and a bound on one would not fit the other.
 */
type CourierLaneShape = Partial<z.infer<typeof courierLaneBase>>;

const sameTown = (a?: string | null, b?: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const laneConnectsTwoTowns = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (v: CourierLaneShape) =>
      v.originDistrict == null ||
      v.destinationDistrict == null ||
      v.originDistrict !== v.destinationDistrict ||
      !sameTown(v.originCity, v.destinationCity),
    {
      message: 'A lane has to connect two different towns — a town is already local to itself.',
      path: ['destinationCity'],
    },
  );
export const createCourierLaneSchema = laneConnectsTwoTowns(courierLaneBase);
export const updateCourierLaneSchema = laneConnectsTwoTowns(
  courierLaneBase.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' }),
);
export type CreateCourierLaneInput = z.infer<typeof courierLaneBase>;
export type UpdateCourierLaneInput = Partial<CreateCourierLaneInput>;

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
    email: z.string().trim().email().max(160).optional(),
    company: z.string().trim().max(120).optional(),
    address: z.string().trim().max(200).optional(),
    address2: z.string().trim().max(200).optional(),
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
  // Booking only. Quoting ignores it, which is the point: asking the price must
  // never move money.
  payWithWallet: z.boolean().optional().default(false),
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

/**
 * Booking is a quote plus the details we only need once it is real.
 *
 * A DOOR end has to answer two separate questions, and conflating them is what
 * broke "drop a pin":
 *
 *   WHERE IS IT — written down or pinned, either one alone. This used to demand
 *   a typed address unconditionally, so a customer who chose "drop a pin", was
 *   shown no street field, and placed their pin was refused at the last step
 *   with "We need the address to collect from". The form and the schema
 *   disagreed about what a complete answer is; the form was right.
 *
 *   WHICH TOWN — always, pin or no pin. The town is not location detail here:
 *   the planner compares towns to decide whether one courier can do the whole
 *   job, and an end with no town reads as "as local as the customer has told
 *   us" — which is how a road courier gets planned for a parcel that has to
 *   cross water. Quoting does not ask for it, because a customer comparing
 *   prices has not filled the form in yet; booking does, because by then the
 *   answer decides the route.
 *
 * A HUB end is asked for neither. The customer is walking into a terminal we
 * already have on file.
 */
export const createShipmentSchema = endpointsMatchService(quoteBase)
  .refine((v: QuoteShape) => !needsFirstMile(v.service) || isLocatable({ street: v.origin.address, latitude: v.origin.latitude, longitude: v.origin.longitude }), {
    message: UNLOCATABLE_ADDRESS_MESSAGE,
    path: ['origin', 'address'],
  })
  .refine((v: QuoteShape) => !needsLastMile(v.service) || isLocatable({ street: v.destination.address, latitude: v.destination.latitude, longitude: v.destination.longitude }), {
    message: UNLOCATABLE_ADDRESS_MESSAGE,
    path: ['destination', 'address'],
  })
  .refine((v: QuoteShape) => !needsFirstMile(v.service) || !!v.origin.city, {
    message: 'Which town are we collecting from?',
    path: ['origin', 'city'],
  })
  .refine((v: QuoteShape) => !needsLastMile(v.service) || !!v.destination.city, {
    message: 'Which town is it going to?',
    path: ['destination', 'city'],
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

/**
 * Resolving a leg exception — the way back out of the state legExceptionSchema
 * records the way into.
 *
 * RESUME says the problem was dealt with where the parcel stands and the same
 * actors continue. RELEASE_DRIVER says the assigned driver cannot do the job
 * and the leg goes back to the dispatch pool — only legal while the parcel has
 * not moved, which the service enforces (custody is not a validation question).
 */
export const resolveLegExceptionSchema = z.object({
  resolution: z.enum(['RESUME', 'RELEASE_DRIVER']),
  note: z.string().trim().min(4, 'Say how it was resolved.').max(500),
});
export type ResolveLegExceptionInput = z.infer<typeof resolveLegExceptionSchema>;

/** Recording that a recipient collected their parcel from a terminal. */
export const collectShipmentSchema = z.object({
  collectedByName: z.string().trim().min(2, 'Who collected it?').max(120),
});
export type CollectShipmentInput = z.infer<typeof collectShipmentSchema>;

/**
 * Admin assigns a driver (+ one of their approved vehicles) to a courier leg by
 * hand — the production path while automatic dispatch is off. Same shape as the
 * delivery console's assign, deliberately: one vocabulary for one job.
 */
export const assignShipmentLegSchema = z.object({
  driverProfileId: cuidSchema,
  vehicleId: cuidSchema,
});
export type AssignShipmentLegInput = z.infer<typeof assignShipmentLegSchema>;

/** Admin reassigns a courier leg; a reason is mandatory (preserves history). */
export const reassignShipmentLegSchema = z.object({
  driverProfileId: cuidSchema,
  vehicleId: cuidSchema,
  reason: z.string().trim().min(1, 'A reason is required.').max(500),
});
export type ReassignShipmentLegInput = z.infer<typeof reassignShipmentLegSchema>;

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
