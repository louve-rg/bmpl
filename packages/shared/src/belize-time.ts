/// Deriving a BUSINESS DAY or WEEKDAY from an instant, in the one place the
/// whole codebase should share (root CLAUDE.md sec 2 and sec 6 — "the planner
/// never guesses" style invariant: a rule stated twice eventually disagrees
/// with itself, and BMPL-197 exists because it already had).
///
/// This does NOT touch how an instant itself is stored, compared or returned
/// — a timestamp is not affected, and nothing here converts one. It only
/// answers "which Belize calendar day / weekday does this instant fall on",
/// which is a calendar question, not a timezone-of-storage question.

/**
 * Belize is UTC-6 year-round — it has never observed daylight saving — so a
 * fixed offset correctly answers "what is Belize's local calendar date/weekday
 * right now" without pulling in an IANA timezone database for a
 * framework-free package (root CLAUDE.md sec 2). If Belize is ever confirmed
 * to have adopted DST, this constant is the one place that would need to
 * become a real zone lookup.
 */
const BELIZE_UTC_OFFSET_MINUTES = -6 * 60;

/**
 * Shifts a UTC instant so that calling the `getUTC*` family on the result
 * yields Belize LOCAL calendar values instead of UTC ones. This is the ONLY
 * place a date crosses from "instant" to "Belize calendar day" in this
 * package; everything below delegates through it rather than repeating the
 * shift at each call site (or, worse, forgetting to).
 *
 * Deliberately independent of the host process's OS/`TZ` setting: it never
 * calls `getHours`/`setHours` or any other local-time accessor, only the
 * `getUTC*` family on an instant already shifted by a fixed offset. A
 * calendar-day derivation that instead relied on process-local time would be
 * correct only on a machine whose `TZ` happened to be America/Belize, and
 * silently wrong — differently wrong depending on the deploy target — on any
 * other one.
 */
export const toBelizeLocal = (d: Date): Date => new Date(d.getTime() + BELIZE_UTC_OFFSET_MINUTES * 60_000);

/**
 * Belize LOCAL weekday for a real instant. 0=Sunday .. 6=Saturday, matching
 * `VendorOpeningHours`/`RouteOperatingDay#dayOfWeek` and JS's own
 * `Date#getUTCDay()` convention (just resolved against Belize local time
 * instead of UTC).
 */
export const belizeWeekday = (d: Date): number => toBelizeLocal(d).getUTCDay();

/** Belize LOCAL calendar date, as a `YYYY-MM-DD` key, for a real instant. */
export const belizeCalendarDateKey = (d: Date): string => {
  const local = toBelizeLocal(d);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Belize LOCAL calendar date, as a UTC-midnight-normalized `Date` — the same
 * representation `@db.Date` columns already use for a pure calendar date
 * (see `RouteScheduleException.date`, `PromotionMetricDaily.day`). Use this
 * when the result is going to be stored in, or compared against, a `@db.Date`
 * column: normalize BOTH sides through here rather than at each call site.
 */
export const belizeCalendarDate = (d: Date): Date => {
  const local = toBelizeLocal(d);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

/**
 * The UTC instant at which Belize's clock reads midnight on the calendar day
 * containing `d` — i.e. the correct lower bound for an "as of the start of
 * [Belize] today" comparison against a real `DateTime`/timestamp column.
 *
 * NOT for comparing against a `@db.Date` column — those already are a pure
 * calendar date and want `belizeCalendarDate`/`belizeCalendarDateKey`
 * instead. This is for the opposite direction: turning a Belize calendar day
 * back into the real instant it starts at, to bound an instant column.
 */
export const startOfBelizeDay = (d: Date): Date => {
  const calendarDate = belizeCalendarDate(d);
  return new Date(calendarDate.getTime() - BELIZE_UTC_OFFSET_MINUTES * 60_000);
};
