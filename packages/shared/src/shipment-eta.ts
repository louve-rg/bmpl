/// A multi-leg shipment ETA, derived ONLY from actually configured
/// schedules, operating hours, exceptions and current shipment state
/// (BMPL-340, Edward requirement 12, owner ruling 11) - never a map
/// service, an average, or an invented timetable. Framework-free, like
/// every other resolver in this package (root CLAUDE.md sec 2), and pure
/// in the same sense route-planner.ts is: every input is a plain value the
/// caller already loaded, nothing here reaches a database or a clock on
/// its own (`now` is a parameter), and the same inputs always produce the
/// same result.
///
/// WHAT THIS IS NOT: dispatch.module.ts, delivery.pricing.ts and
/// driver-jobs.service.ts each carry their own comment disclaiming an ETA
/// - but all three are the MARKETPLACE DELIVERY dispatch engine, the
/// per-vendor flat-fee/zone quoter, and the DRIVER's own multi-stop queue
/// distance estimate respectively. None of the three is the shipping
/// domain this file lives in, and none of their reasons hold against a
/// shipment ETA built from configured data - they were never about this.
///
/// THE HARD LINE THIS FILE HOLDS: if a leg's start or arrival cannot be
/// anchored to a real piece of configured data (a carrier's own scheduled
/// commitment, a terminal's configured hours, a sender/recipient
/// availability window, or - simplest of all - the leg has already
/// actually happened), the answer is UNKNOWN. The same shape
/// shipment.service.ts's dateAvailability() (BMPL-283) already uses:
/// search what is actually configured, bounded, and degrade to "cannot
/// say" rather than guess past the horizon. An ETA that is wrong is worse
/// than no ETA, because a customer plans around it.

import { isAvailable, nextAvailableInstant, type AvailabilityWindow } from './availability-windows';
import { nextOpenWindow, resolveHoursStatus, windowStartInstant, type HoursException, type WeeklyOpeningHours } from './hub-hours';
import type { LegKind, LegStatus } from './shipping';

/**
 * `KNOWN` - the leg has already finished, or a carrier's own commitment
 * (`scheduledArrivalAt`) is being used directly: not a projection at all.
 * `PROJECTED` - computed from configured duration plus hours/windows; the
 * leg has not happened yet (or is in progress), so this is a best-effort
 * estimate, still entirely from configured data.
 * `UNKNOWN` - no configured signal anchors a start or arrival time. A
 * caller must show this as "cannot be estimated yet", never fall back to
 * a guess.
 */
export const ETA_CONFIDENCES = ['KNOWN', 'PROJECTED', 'UNKNOWN'] as const;
export type EtaConfidence = (typeof ETA_CONFIDENCES)[number];

export interface EtaLegInput {
  sequence: number;
  kind: LegKind;
  status: LegStatus;
  /** Configured/quoted duration for this leg (the planner's own total for
   *  it) - the ONE number every leg always has, regardless of kind. */
  durationMinutes: number;
  /** Only meaningful for FIRST_MILE (route-planner.ts's own convention:
   *  the origin-side terminal a first-mile leg ends at; null for every
   *  other kind) - which hub's configured hours gate this leg's arrival. */
  destinationHubId: string | null;
  /** When this leg actually began, if it has (set at the IN_PROGRESS
   *  transition, every kind, the same generic field shipment.service.ts
   *  writes regardless of courier vs. carrier). */
  startedAt: Date | null;
  /** When this leg actually finished, if it has. */
  completedAt: Date | null;
  /** A carrier's own configured commitment (LINE_HAUL only). Written by
   *  `ShipmentService.scheduleLeg` (BMPL-346) via the admin logistics and
   *  carrier provider-legs `POST legs/:id/schedule` routes - absent one,
   *  there is genuinely nothing configured to anchor a start time to, and
   *  an unstarted LINE_HAUL leg stays UNKNOWN honestly, not as a bug in
   *  this function. */
  scheduledDepartureAt: Date | null;
  scheduledArrivalAt: Date | null;
}

export interface EtaLegResult {
  sequence: number;
  confidence: EtaConfidence;
  /** Null exactly when confidence is UNKNOWN. */
  estimatedCompletionAt: Date | null;
  /** Null when confidence is KNOWN (a completed leg, or a carrier's own
   *  arrival commitment, needs no explanation) or the very first live leg
   *  starting immediately with nothing to wait on. */
  reason: string | null;
}

export interface ShipmentEtaResult {
  legs: EtaLegResult[];
  /** The weakest confidence among every LIVE leg - UNKNOWN propagates
   *  forward from the first leg that cannot be anchored, because every
   *  later leg's own start depends on it. */
  confidence: EtaConfidence;
  /** The last live leg's estimatedCompletionAt, or null when confidence is
   *  UNKNOWN or there is no live leg left to finish. */
  estimatedArrivalAt: Date | null;
}

/** Per-hub configured hours, keyed by hub id - only the hubs this
 *  shipment's FIRST_MILE leg(s) actually reference need to be present. */
export type HubHoursByHub = ReadonlyMap<string, { weeklyPattern: readonly WeeklyOpeningHours[]; exceptions: readonly HoursException[] }>;

/**
 * Estimate a shipment's remaining journey from its legs' current state.
 *
 * Walks live legs (CANCELLED ones excluded, same as `deriveShipmentStatus`)
 * in sequence order, carrying forward a cursor: each leg's earliest
 * possible start is `max(now, the previous live leg's own completion -
 * actual or projected)`, because `isLegActionable` already establishes
 * that a leg may not even be worked until every earlier live leg has
 * completed - the same invariant this function's cursor encodes.
 *
 * The moment one leg resolves UNKNOWN, every leg after it is reported
 * UNKNOWN too without being individually evaluated - their own start
 * depends on an instant this function cannot honestly name, so attempting
 * one would only be inventing a different number to hide the same gap.
 */
export function estimateShipmentEta(
  legs: readonly EtaLegInput[],
  now: Date,
  hubHours: HubHoursByHub,
  availabilityWindows: readonly AvailabilityWindow[],
): ShipmentEtaResult {
  const live = [...legs].filter((l) => l.status !== 'CANCELLED').sort((a, b) => a.sequence - b.sequence);
  if (live.length === 0) {
    return { legs: [], confidence: 'UNKNOWN', estimatedArrivalAt: null };
  }

  const results: EtaLegResult[] = [];
  // `cursor === null` means "already unknown" - every subsequent leg is
  // reported UNKNOWN without inspection, per this function's own contract.
  let cursor: Date | null = now;

  for (const leg of live) {
    if (leg.status === 'COMPLETED') {
      const at = leg.completedAt ?? leg.startedAt ?? now; // defensive only; the write path always sets completedAt
      results.push({ sequence: leg.sequence, confidence: 'KNOWN', estimatedCompletionAt: at, reason: null });
      if (cursor !== null) cursor = at;
      continue;
    }
    if (leg.status === 'EXCEPTION') {
      results.push({
        sequence: leg.sequence,
        confidence: 'UNKNOWN',
        estimatedCompletionAt: null,
        reason: 'this leg needs attention before its onward journey can be estimated',
      });
      cursor = null;
      continue;
    }
    if (cursor === null) {
      results.push({
        sequence: leg.sequence,
        confidence: 'UNKNOWN',
        estimatedCompletionAt: null,
        reason: 'an earlier leg cannot be estimated yet',
      });
      continue;
    }

    // A leg already IN_PROGRESS has a real startedAt, more accurate than
    // the cursor: `isLegActionable`'s own invariant (every earlier live leg
    // must be COMPLETED first) makes it impossible for startedAt to predate
    // the cursor, so trusting it directly - not "whichever is later" - is
    // safe and gives a truer projection than restarting the clock at `now`.
    const anchor = leg.startedAt ?? cursor;
    const leg_ = projectLeg(leg, anchor, hubHours, availabilityWindows);
    results.push(leg_);
    cursor = leg_.confidence === 'UNKNOWN' ? null : leg_.estimatedCompletionAt;
  }

  const overall = results.some((r) => r.confidence === 'UNKNOWN') ? 'UNKNOWN' : results.some((r) => r.confidence === 'PROJECTED') ? 'PROJECTED' : 'KNOWN';
  const last = results[results.length - 1]!;
  return {
    legs: results,
    confidence: overall,
    estimatedArrivalAt: overall === 'UNKNOWN' ? null : last.estimatedCompletionAt,
  };
}

function projectLeg(
  leg: EtaLegInput,
  anchor: Date,
  hubHours: HubHoursByHub,
  availabilityWindows: readonly AvailabilityWindow[],
): EtaLegResult {
  if (leg.kind === 'LINE_HAUL') return projectLineHaul(leg, anchor);
  if (leg.kind === 'FIRST_MILE') return projectFirstMile(leg, anchor, hubHours, availabilityWindows);
  if (leg.kind === 'LAST_MILE') return projectLastMile(leg, anchor, availabilityWindows);
  return projectDirect(leg, anchor, availabilityWindows); // DIRECT
}

/** A carrier's own commitment is the most authoritative signal there is -
 *  it is not a projection at all once given. Absent one, there is
 *  genuinely nothing configured to anchor a start time to. */
function projectLineHaul(leg: EtaLegInput, anchor: Date): EtaLegResult {
  if (leg.scheduledArrivalAt) {
    return { sequence: leg.sequence, confidence: 'KNOWN', estimatedCompletionAt: leg.scheduledArrivalAt, reason: null };
  }
  if (leg.scheduledDepartureAt) {
    const start = leg.scheduledDepartureAt.getTime() > anchor.getTime() ? leg.scheduledDepartureAt : anchor;
    return {
      sequence: leg.sequence,
      confidence: 'PROJECTED',
      estimatedCompletionAt: new Date(start.getTime() + leg.durationMinutes * 60_000),
      reason: null,
    };
  }
  return {
    sequence: leg.sequence,
    confidence: 'UNKNOWN',
    estimatedCompletionAt: null,
    reason: 'no carrier departure has been confirmed for this leg yet',
  };
}

/** Gated by the SENDER's availability window at pickup and the
 *  destination terminal's configured hours at arrival - the exact two
 *  checks shipment-dispatch.service.ts already enforces before offering
 *  this leg to a driver (BMPL-273/284/287), read here instead of thrown
 *  away after one dispatch tick. */
function projectFirstMile(
  leg: EtaLegInput,
  anchor: Date,
  hubHours: HubHoursByHub,
  availabilityWindows: readonly AvailabilityWindow[],
): EtaLegResult {
  const senderReady = isAvailable(anchor, availabilityWindows, 'SENDER')
    ? anchor
    : nextAvailableInstant(anchor, availabilityWindows, 'SENDER');
  const provisional = new Date(senderReady.getTime() + leg.durationMinutes * 60_000);

  if (!leg.destinationHubId) {
    return { sequence: leg.sequence, confidence: 'PROJECTED', estimatedCompletionAt: provisional, reason: null };
  }
  const hours = hubHours.get(leg.destinationHubId);
  if (!hours) {
    // No configured-hours data was supplied for this hub at all - treat as
    // unconstrained (hub-hours.ts's own documented default for a hub with
    // zero rows: configuring nothing changes nothing), not as unknown.
    return { sequence: leg.sequence, confidence: 'PROJECTED', estimatedCompletionAt: provisional, reason: null };
  }
  const status = resolveHoursStatus(provisional, hours.weeklyPattern, hours.exceptions);
  if (status.isOpen) {
    return { sequence: leg.sequence, confidence: 'PROJECTED', estimatedCompletionAt: provisional, reason: null };
  }
  const next = nextOpenWindow(provisional, hours.weeklyPattern, hours.exceptions);
  if (!next) {
    return {
      sequence: leg.sequence,
      confidence: 'UNKNOWN',
      estimatedCompletionAt: null,
      reason: 'the destination terminal has no configured opening window within the next two weeks',
    };
  }
  return {
    sequence: leg.sequence,
    confidence: 'PROJECTED',
    estimatedCompletionAt: windowStartInstant(next, provisional),
    reason: 'waiting for the destination terminal to open',
  };
}

/** Gated by the RECIPIENT's availability window at the projected delivery
 *  instant - no hub involved, a LAST_MILE leg ends at a door. */
function projectLastMile(leg: EtaLegInput, anchor: Date, availabilityWindows: readonly AvailabilityWindow[]): EtaLegResult {
  const provisional = new Date(anchor.getTime() + leg.durationMinutes * 60_000);
  if (isAvailable(provisional, availabilityWindows, 'RECIPIENT')) {
    return { sequence: leg.sequence, confidence: 'PROJECTED', estimatedCompletionAt: provisional, reason: null };
  }
  const next = nextAvailableInstant(provisional, availabilityWindows, 'RECIPIENT');
  return {
    sequence: leg.sequence,
    confidence: 'PROJECTED',
    estimatedCompletionAt: next,
    reason: 'waiting for the recipient’s configured availability window',
  };
}

/** One courier, door to door - gated by BOTH the sender at pickup and the
 *  recipient at the projected delivery instant, the same two checks
 *  shipment-dispatch.service.ts applies to a DIRECT leg. No hub either
 *  side: a door-to-door journey never touches a terminal. */
function projectDirect(leg: EtaLegInput, anchor: Date, availabilityWindows: readonly AvailabilityWindow[]): EtaLegResult {
  const senderReady = isAvailable(anchor, availabilityWindows, 'SENDER') ? anchor : nextAvailableInstant(anchor, availabilityWindows, 'SENDER');
  const provisional = new Date(senderReady.getTime() + leg.durationMinutes * 60_000);
  if (isAvailable(provisional, availabilityWindows, 'RECIPIENT')) {
    return { sequence: leg.sequence, confidence: 'PROJECTED', estimatedCompletionAt: provisional, reason: null };
  }
  const next = nextAvailableInstant(provisional, availabilityWindows, 'RECIPIENT');
  return {
    sequence: leg.sequence,
    confidence: 'PROJECTED',
    estimatedCompletionAt: next,
    reason: 'waiting for the recipient’s configured availability window',
  };
}
