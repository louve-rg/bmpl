/**
 * The driver's job, whatever it came from.
 *
 * A driver does not care whether the work in front of them originated as a
 * marketplace order or as one leg of a parcel flying to San Pedro. They care
 * where to collect, where to drop, what they are moving, and what to press next.
 *
 * So the driver app talks in DriverJobs. Two very different backend records
 * project into this one shape:
 *
 *   MARKETPLACE  — an OrderDelivery: vendor to customer, one hop.
 *   FIRST_MILE   — a shipment leg: sender's door to the departure terminal.
 *   LAST_MILE    — a shipment leg: arrival terminal to the recipient's door.
 *
 * The projection is presentation only. Neither state machine is merged into the
 * other; each record keeps its own transitions, its own guards and its own
 * history. What is shared is the vocabulary the driver sees — which is exactly
 * the part that should be shared, and exactly the part that would otherwise
 * drift into two subtly different driver experiences.
 */

import type { DeliveryStatus } from './dispatch';

/* ------------------------------------------------------------- job kinds */

export const DRIVER_JOB_KINDS = ['MARKETPLACE', 'DIRECT', 'FIRST_MILE', 'LAST_MILE'] as const;
export type DriverJobKind = (typeof DRIVER_JOB_KINDS)[number];

/**
 * What the driver is told this job is. Deliberately plain: "Shipping pickup"
 * rather than "first-mile courier leg". The driver is not operating a logistics
 * network, they are collecting a parcel and taking it somewhere.
 */
export const DRIVER_JOB_KIND_LABELS: Record<DriverJobKind, string> = {
  MARKETPLACE: 'Marketplace delivery',
  DIRECT: 'Shipping job',
  FIRST_MILE: 'Shipping pickup',
  LAST_MILE: 'Shipping delivery',
};

/** A one-line description of the trip, for the job card's subtitle. */
export const DRIVER_JOB_KIND_SHAPE: Record<DriverJobKind, string> = {
  MARKETPLACE: 'Store to customer',
  DIRECT: 'Sender to recipient',
  FIRST_MILE: 'Sender to terminal',
  LAST_MILE: 'Terminal to recipient',
};

/** Is this job one leg of a longer journey? Drives the "part of a shipment" hint. */
export const isShipmentJob = (kind: DriverJobKind): boolean => kind !== 'MARKETPLACE';

/* ------------------------------------------------------- the shared shape */

/** One end of a job, as a driver needs to see it before they have accepted. */
export interface DriverJobPlace {
  /** "Sunrise Grocery", "Placencia Airstrip", or null for a private address. */
  name: string | null;
  /** Always safe to show: the town/district, never the street. */
  area: string | null;
}

/**
 * A job in a list. Carries nothing that identifies a private individual — a
 * driver browsing offers has not accepted anything yet, so the far end is an
 * AREA until they do. The detail view, behind the ownership check, is where the
 * street address and the phone number live.
 */
export interface DriverJobSummary {
  id: string;
  kind: DriverJobKind;
  kindLabel: string;
  /** Which of the four driver tabs this belongs under. */
  view: DriverDeliveryViewName | null;
  status: DeliveryStatus;
  statusLabel: string;
  reference: string;
  pickup: DriverJobPlace;
  dropoff: DriverJobPlace;
  /** "3 items", "1 parcel" — what am I moving. */
  load: string;
  feeMinor: number;
  assignedAt: Date | string | null;
  acceptedAt: Date | string | null;
  completedAt: Date | string | null;
  offerExpiresAt: Date | string | null;
  queuePosition: number | null;
  isTest: boolean;
}

/** Kept structural rather than importing, to avoid a cycle with driver-queue. */
type DriverDeliveryViewName = 'available' | 'assigned' | 'active' | 'completed';

/**
 * Sort key for a mixed feed.
 *
 * Offers first and expiring soonest — an offer is the only item with a clock on
 * it, and a driver who misses it loses the work. After that the driver's own
 * ordering, then oldest first, because the thing waiting longest is the thing to
 * do. Job kind deliberately does NOT enter the ordering: a shipping pickup is
 * not more or less urgent than a marketplace delivery, and sorting by type would
 * quietly tell drivers otherwise.
 */
export function compareDriverJobs(a: DriverJobSummary, b: DriverJobSummary): number {
  const aOffer = a.acceptedAt == null && a.offerExpiresAt != null;
  const bOffer = b.acceptedAt == null && b.offerExpiresAt != null;
  if (aOffer !== bOffer) return aOffer ? -1 : 1;
  if (aOffer && bOffer) return time(a.offerExpiresAt) - time(b.offerExpiresAt);

  const aq = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
  const bq = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
  if (aq !== bq) return aq - bq;

  return time(a.assignedAt) - time(b.assignedAt);
}

function time(v: Date | string | null): number {
  if (v == null) return Number.MAX_SAFE_INTEGER;
  return new Date(v).getTime();
}

/**
 * The next thing the driver should press, phrased for the job they are on.
 *
 * The underlying transitions are identical — the delivery state machine drives
 * both — but the words are not. "Confirm pickup" is right at a store counter and
 * wrong at an airstrip, where the driver is handing a parcel OVER rather than
 * taking one. Getting this wrong is how a driver taps the correct button while
 * believing they are doing the opposite thing.
 */
export function driverJobActionLabel(kind: DriverJobKind, status: DeliveryStatus): string | null {
  switch (status) {
    case 'ASSIGNED':
      return 'Accept';
    case 'DRIVER_ACCEPTED':
      return kind === 'LAST_MILE' ? 'Collect from terminal' : 'Confirm pickup';
    case 'PICKUP_CONFIRMED':
      return 'Start the trip';
    case 'IN_TRANSIT':
      return kind === 'FIRST_MILE' ? 'Arriving at terminal' : 'Arriving';
    case 'ARRIVING':
      return kind === 'FIRST_MILE' ? 'Hand over at terminal' : 'Confirm delivery';
    default:
      return null;
  }
}

/**
 * Who holds the code the driver has to produce at the end of this job.
 *
 * Shown on the job card so the driver knows who to ask before they arrive,
 * rather than discovering it at a counter.
 */
export function driverJobCodeHolder(kind: DriverJobKind): string {
  return kind === 'FIRST_MILE' ? 'the terminal staff' : 'the person receiving it';
}
