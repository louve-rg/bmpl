/// Whether a shipment's sender or recipient is available at a projected
/// pickup/delivery instant (BMPL-284/285/287).
///
/// NOT the hub-hours resolver shape (service-schedule.ts / hub-hours.ts).
/// Those exist to answer "what applies on THIS calendar date", because a
/// hub, a vendor or a route operates indefinitely across recurring days
/// with a weekly default and date-specific overrides. A shipment's window
/// has no such axis at all (BMPL-284's own finding): it is one fixed set
/// of time-of-day ranges that apply identically on whichever day the
/// sweeper is still retrying on, sender-side or recipient-side. So this
/// only ever answers "does this time of day fall in one of these ranges" -
/// there is no calendar date to resolve against, and reusing the
/// weekly-pattern-plus-exception machinery here would be exactly the
/// "second hours system built by accident" that finding ruled out.
///
/// Framework-free by design, the same reason belize-time.ts and
/// hub-hours.ts are: the API and any future browser-side preview must
/// agree on this, and a rule stated twice is a rule that will eventually
/// disagree with itself.

import { startOfBelizeDay, toBelizeLocal } from './belize-time';
import type { AvailabilityWindowRole } from './shipping';

export interface AvailabilityWindow {
  role: AvailabilityWindowRole;
  /** "HH:MM", Belize local. May describe an OVERNIGHT window
   *  (endTime < startTime, e.g. "22:00" to "02:00") - see `isAvailable`'s
   *  own comment before assuming a simple range comparison. */
  startTime: string;
  endTime: string;
}

/** "HH:MM" -> minutes since midnight. Same parsing as hub-hours.ts. */
function parseMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}

/** Minutes since Belize-local midnight for a real instant. */
function minutesOfDayBelize(instant: Date): number {
  const local = toBelizeLocal(instant);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Whether `instant` falls inside any of `windows` for one role (SENDER or
 * RECIPIENT).
 *
 * NO WINDOWS FOR THAT ROLE MEANS UNCONSTRAINED - available at any time.
 * This is BMPL-285's own documented default, not invented here: every
 * shipment without a configured window must keep dispatching exactly as
 * it does today, so absence can never resolve to "never available".
 *
 * OVERNIGHT WINDOWS ARE HANDLED DELIBERATELY, not assumed away and not
 * refused. BMPL-285's CHECK only forbids a zero-duration window
 * (startTime === endTime) — it explicitly permits startTime > endTime,
 * e.g. "22:00" to "02:00", the same shape already refused as a permanent
 * foreclosure for hub_hours_exceptions on BMPL-263. Left at three call
 * sites (the migration, the Prisma model, this package's validation
 * schema) as an obligation for whoever built the first consumer: THAT IS
 * THIS FUNCTION. A same-day window (startTime < endTime) is membership by
 * AND (start <= t < end) — the ordinary case. An overnight window
 * (startTime > endTime) is membership by OR (t >= start OR t < end), the
 * standard wraparound test: available from startTime through midnight,
 * AND from midnight through endTime the following clock reading. Writing
 * this as a single `start <= t && t < end` comparison — the naive
 * membership test a future author would otherwise reach for — would make
 * every overnight window silently never match, reintroducing hub-hours'
 * own documented limitation in a new place by someone who never read this
 * comment.
 */
export function isAvailable(instant: Date, windows: readonly AvailabilityWindow[], role: AvailabilityWindowRole): boolean {
  const relevant = windows.filter((w) => w.role === role);
  if (relevant.length === 0) return true;
  const t = minutesOfDayBelize(instant);
  return relevant.some((w) => {
    const start = parseMinutes(w.startTime);
    const end = parseMinutes(w.endTime);
    return start < end ? t >= start && t < end : t >= start || t < end;
  });
}

/**
 * The next instant at/after `from` when `role` becomes available (BMPL-340)
 * - composes on top of `isAvailable` rather than re-deriving membership.
 * Unlike `nextOpenWindow` (hub-hours.ts), this never needs a multi-day
 * bounded search and never returns null: a window is a pure time-of-day
 * range with no calendar axis (this file's own header), so it repeats
 * every day and its next occurrence is always within 24 hours of `from` -
 * and `relevant.length === 0` (no configured window for this role) already
 * returns `true` from `isAvailable` above, so this function is only ever
 * reached when at least one window exists to search.
 */
export function nextAvailableInstant(from: Date, windows: readonly AvailabilityWindow[], role: AvailabilityWindowRole): Date {
  if (isAvailable(from, windows, role)) return from;
  const relevant = windows.filter((w) => w.role === role);
  if (relevant.length === 0) return from; // unreachable given isAvailable's own default above; kept explicit rather than assumed
  const fromMinutes = minutesOfDayBelize(from);
  const dayStart = startOfBelizeDay(from);
  const nextOffset = Math.min(
    ...relevant.map((w) => {
      const start = parseMinutes(w.startTime);
      return start > fromMinutes ? start : start + 24 * 60; // today if still ahead, else tomorrow's occurrence
    }),
  );
  return new Date(dayStart.getTime() + nextOffset * 60_000);
}
