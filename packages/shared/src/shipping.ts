/**
 * Multi-leg shipping — the shared domain vocabulary.
 *
 * WHY THIS EXISTS BESIDE OrderDelivery, NOT INSTEAD OF IT.
 *
 * A Belize City vendor delivering to a Belize City customer is one courier and
 * one custody transfer, and the OrderDelivery state machine already models that
 * correctly and is heavily tested. Forcing it through a shipment orchestrator
 * would add legs, hubs and handoffs to a journey that has none of them.
 *
 * Placencia to San Pedro is a different shape: several custody transfers, a
 * carrier BML does not employ, and a parcel that sits at a terminal in between.
 * That needs orchestration ABOVE the courier layer, and each courier leg is
 * still an ordinary OrderDelivery underneath, dispatched by the existing engine
 * to the existing drivers.
 *
 * So: a Shipment is a plan. Its legs are the steps. A courier leg delegates to
 * the proven delivery machinery; a line-haul leg is operated by a carrier and
 * confirmed by an operator. The customer sees one journey.
 *
 * Framework-free so the API, the web app and the tests share one definition.
 */

/* ------------------------------------------------------------ transport */

/** How a leg physically moves. */
export const TRANSPORT_MODES = ['LAND', 'AIR', 'SEA'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  LAND: 'Road',
  AIR: 'Flight',
  SEA: 'Boat',
};

/* ----------------------------------------------------------------- hubs */

/**
 * Somewhere a parcel can be handed over. Deliberately broad: BML does not own
 * airports or water-taxi terminals, it hands parcels to whoever does.
 */
export const HUB_TYPES = [
  'AIRPORT',
  'AIRSTRIP',
  'WATER_TAXI_TERMINAL',
  'SEA_TERMINAL',
  'BUS_TERMINAL',
  'WAREHOUSE',
  'DISTRIBUTION_CENTER',
  'BMPL_HUB',
] as const;
export type HubType = (typeof HUB_TYPES)[number];

export const HUB_TYPE_LABELS: Record<HubType, string> = {
  AIRPORT: 'Airport',
  AIRSTRIP: 'Airstrip',
  WATER_TAXI_TERMINAL: 'Water taxi terminal',
  SEA_TERMINAL: 'Sea terminal',
  BUS_TERMINAL: 'Bus terminal',
  WAREHOUSE: 'Warehouse',
  DISTRIBUTION_CENTER: 'Distribution centre',
  BMPL_HUB: 'BML hub',
};

/* -------------------------------------------------------- service level */

/**
 * What the customer is buying, expressed as which ends BML is responsible for.
 * "Door" means we collect from / deliver to an address; "Hub" means the customer
 * or recipient handles that end at a terminal themselves.
 */
export const SHIPPING_SERVICES = ['DOOR_TO_DOOR', 'DOOR_TO_HUB', 'HUB_TO_DOOR', 'HUB_TO_HUB'] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];

export const SHIPPING_SERVICE_LABELS: Record<ShippingService, string> = {
  DOOR_TO_DOOR: 'Door to door',
  DOOR_TO_HUB: 'Door to terminal',
  HUB_TO_DOOR: 'Terminal to door',
  HUB_TO_HUB: 'Terminal to terminal',
};

/** Customer-facing explanations. No internal jargon. */
export const SHIPPING_SERVICE_DESCRIPTIONS: Record<ShippingService, string> = {
  DOOR_TO_DOOR: 'We collect from the sender and deliver to the door. You do nothing in between.',
  DOOR_TO_HUB: 'We collect from the sender and take it to the terminal. The recipient collects it there.',
  HUB_TO_DOOR: 'You drop it at the terminal. We take it from there and deliver to the door.',
  HUB_TO_HUB: 'You drop it at the terminal and the recipient collects it at the other end.',
};

/** Does this service need us to collect from an address? */
export const needsFirstMile = (s: ShippingService): boolean => s === 'DOOR_TO_DOOR' || s === 'DOOR_TO_HUB';
/** Does this service need us to deliver to an address? */
export const needsLastMile = (s: ShippingService): boolean => s === 'DOOR_TO_DOOR' || s === 'HUB_TO_DOOR';

/* ------------------------------------------------------------ leg kinds */

/** A leg's role in the journey. */
/**
 * DIRECT is one courier taking a parcel from the sender's door straight to the
 * recipient's door. It exists because a local door-to-door journey genuinely has
 * no terminal in it, and the alternative — inventing a hub transfer for a parcel
 * that never goes near a terminal — would both mis-price the job and send the
 * driver somewhere nobody needs them to go.
 */
export const LEG_KINDS = ['DIRECT', 'FIRST_MILE', 'LINE_HAUL', 'LAST_MILE'] as const;
export type LegKind = (typeof LEG_KINDS)[number];

export const LEG_KIND_LABELS: Record<LegKind, string> = {
  DIRECT: 'Collection and delivery',
  FIRST_MILE: 'Collection',
  LINE_HAUL: 'Transport',
  LAST_MILE: 'Final delivery',
};

/** Legs a BML courier drives, as opposed to a carrier's line-haul. */
export const COURIER_LEG_KINDS: readonly LegKind[] = ['DIRECT', 'FIRST_MILE', 'LAST_MILE'];
export const isCourierLeg = (k: LegKind): boolean => COURIER_LEG_KINDS.includes(k);

/* --------------------------------------------------------- leg statuses */

export const LEG_STATUSES = [
  'PENDING', // planned, not yet actionable
  'READY', // its turn - a courier may be dispatched / a carrier may load
  'IN_PROGRESS', // parcel is moving on this leg
  'COMPLETED', // custody handed to the next holder
  'CANCELLED',
  'EXCEPTION',
] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];

/** Legs that are finished one way or another. */
export const TERMINAL_LEG_STATUSES: readonly LegStatus[] = ['COMPLETED', 'CANCELLED'];

/* ---------------------------------------------------- shipment statuses */

/**
 * Shipment status is DERIVED from the legs (see `deriveShipmentStatus`), never
 * set independently. Two writable sources for one fact is how they drift.
 */
export const SHIPMENT_STATUSES = [
  'DRAFT',
  'AWAITING_PICKUP',
  'FIRST_MILE',
  'AT_ORIGIN_HUB',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'AWAITING_COLLECTION', // ends at a hub; the recipient collects
  'DELIVERED',
  'EXCEPTION',
  'CANCELLED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: 'Not yet booked',
  AWAITING_PICKUP: 'Waiting to be collected',
  FIRST_MILE: 'On the way to the terminal',
  AT_ORIGIN_HUB: 'At the departure terminal',
  IN_TRANSIT: 'In transit',
  AT_DESTINATION_HUB: 'Arrived at the destination terminal',
  OUT_FOR_DELIVERY: 'Out for delivery',
  AWAITING_COLLECTION: 'Ready to collect',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Needs attention',
  CANCELLED: 'Cancelled',
};

/* -------------------------------------------------------------- custody */

/** Who is holding the parcel. Every transfer is recorded. */
export const CUSTODY_HOLDERS = ['SENDER', 'DRIVER', 'HUB', 'CARRIER', 'RECIPIENT'] as const;
export type CustodyHolder = (typeof CUSTODY_HOLDERS)[number];

/* ---------------------------------------------------------- derivations */

export interface LegView {
  sequence: number;
  kind: LegKind;
  mode: TransportMode;
  status: LegStatus;
}

/**
 * The shipment's status, computed from its legs.
 *
 * `endsAtHub` distinguishes "delivered to the door" from "waiting to be
 * collected at a terminal" — both are successful completions, and calling the
 * second one DELIVERED would tell the recipient their parcel had arrived
 * somewhere it has not.
 */
export function deriveShipmentStatus(legs: readonly LegView[], endsAtHub: boolean): ShipmentStatus {
  if (legs.length === 0) return 'DRAFT';
  if (legs.some((l) => l.status === 'EXCEPTION')) return 'EXCEPTION';

  const ordered = [...legs].sort((a, b) => a.sequence - b.sequence);
  const live = ordered.filter((l) => l.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';

  if (live.every((l) => l.status === 'COMPLETED')) return endsAtHub ? 'AWAITING_COLLECTION' : 'DELIVERED';

  // The first leg that has not finished is the one that describes the shipment.
  const current = live.find((l) => l.status !== 'COMPLETED')!;
  const priorDone = live.filter((l) => l.sequence < current.sequence).every((l) => l.status === 'COMPLETED');

  // One courier, door to door. Before they set off the parcel is still with the
  // sender; once they have it, it is on its way to the recipient. Falling through
  // to the LAST_MILE branch below would report "at the destination terminal" for
  // a journey that has no terminal and has not even been collected yet.
  if (current.kind === 'DIRECT') {
    return current.status === 'IN_PROGRESS' ? 'OUT_FOR_DELIVERY' : 'AWAITING_PICKUP';
  }
  if (current.kind === 'FIRST_MILE') {
    return current.status === 'IN_PROGRESS' ? 'FIRST_MILE' : 'AWAITING_PICKUP';
  }
  if (current.kind === 'LINE_HAUL') {
    if (current.status === 'IN_PROGRESS') return 'IN_TRANSIT';
    // Waiting to depart: at the origin hub if it actually got there, otherwise
    // still being collected.
    return priorDone ? 'AT_ORIGIN_HUB' : 'AWAITING_PICKUP';
  }
  // LAST_MILE
  if (current.status === 'IN_PROGRESS') return 'OUT_FOR_DELIVERY';
  return priorDone ? 'AT_DESTINATION_HUB' : 'IN_TRANSIT';
}

/**
 * May this leg start?
 *
 * The rule that stops a final-mile courier being dispatched to a terminal the
 * parcel has not reached: a leg is actionable only once every earlier live leg
 * has completed. Sequence is authority; nothing may jump the queue.
 */
export function isLegActionable(legs: readonly LegView[], sequence: number): boolean {
  const ordered = [...legs].sort((a, b) => a.sequence - b.sequence);
  const target = ordered.find((l) => l.sequence === sequence);
  if (!target) return false;
  if (TERMINAL_LEG_STATUSES.includes(target.status) || target.status === 'EXCEPTION') return false;
  return ordered
    .filter((l) => l.sequence < sequence && l.status !== 'CANCELLED')
    .every((l) => l.status === 'COMPLETED');
}
