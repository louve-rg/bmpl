import { nextOpenWindow, resolveHoursStatus, type HoursException, type WeeklyOpeningHours } from '@bmpl/shared';

/**
 * The customer-facing "closed now" badge for a storefront (BMPL-335, owner
 * ruling 10).
 *
 * Configured opening hours CONSTRAIN DISPATCH, they do not block ordering —
 * an order placed while a vendor is closed is still accepted and dispatched
 * once they reopen (dispatch-engine.service.ts's deferral, BMPL-177/
 * BMPL-334). So this never says or implies the order cannot be placed; it
 * only ever says the vendor is closed now and when the order will actually
 * go out.
 *
 * NO CONFIGURED HOURS MEANS NO BADGE AT ALL — not "hours unknown", not a
 * neutral chip, nothing. Absence means unconstrained, the same answer
 * dispatch itself gives; a vendor who has set nothing must look exactly as
 * they did before this feature shipped.
 *
 * Computed from BOTH the weekly pattern AND the exception rows. Either
 * alone can give the wrong answer on an excepted date: a normally-open day
 * with a CLOSED exception would show no badge while dispatch actually
 * defers the order, and a normally-closed day with a MODIFIED exception
 * would show "closed" while the vendor is genuinely open and the order
 * would go straight through — the second is exactly "a badge asserting a
 * behaviour the system does not have", the trap this card exists to avoid.
 */

export interface VendorWeeklyHour {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

/**
 * Exactly the four fields the public storefront payload carries for an
 * exception — deliberately never `reason` (the vendor's own private note,
 * e.g. "family emergency") or `createdByUserId` (identifies a person);
 * see vendor.service.ts's STOREFRONT_INCLUDE select.
 */
export interface VendorHoursExceptionPublic {
  /** "YYYY-MM-DD" — a pure calendar date, exactly like RouteScheduleException
   *  and HubHoursException. */
  date: string;
  status: 'CLOSED' | 'MODIFIED';
  openTime: string | null;
  closeTime: string | null;
}

export interface VendorClosedBadge {
  message: string;
}

export function vendorClosedBadge(
  weeklyHours: readonly VendorWeeklyHour[],
  exceptions: readonly VendorHoursExceptionPublic[],
  now: Date = new Date(),
): VendorClosedBadge | null {
  if (weeklyHours.length === 0 && exceptions.length === 0) return null;

  const weeklyPattern: WeeklyOpeningHours[] = weeklyHours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    openTime: h.openTime,
    closeTime: h.closeTime,
    isClosed: h.isClosed,
  }));

  // Exception dates are pure calendar dates. resolveHoursStatus/
  // nextOpenWindow compare them with NO Belize shift (exactly like
  // RouteScheduleException/HubHoursException — see hub-hours.ts's own
  // effectiveHoursForDate), so parsing the wire's "YYYY-MM-DD" directly is
  // correct here. belizeMidday exists for the OPPOSITE case — re-anchoring a
  // calendar date that is about to be treated as an INSTANT (BMPL-283) —
  // which is not what happens to these dates; `now` below is already a
  // real instant and needs no re-anchoring of its own.
  const hoursExceptions: HoursException[] = exceptions.map((e) => ({
    date: new Date(e.date),
    status: e.status,
    openTime: e.openTime,
    closeTime: e.closeTime,
  }));

  const resolution = resolveHoursStatus(now, weeklyPattern, hoursExceptions);
  if (resolution.isOpen) return null;

  const next = nextOpenWindow(now, weeklyPattern, hoursExceptions);
  if (!next) {
    return {
      message: 'Closed now. We could not confirm when they reopen, but an order placed now will still be dispatched once they do.',
    };
  }

  const reopens = formatCalendarDate(next.date);
  const atTime = next.openTime ? ` at ${next.openTime}` : '';
  return { message: `Closed now — reopens ${reopens}${atTime}. Orders placed now will be dispatched then.` };
}

/**
 * `d` is a pure calendar date (UTC-midnight-normalized, exactly the shape
 * `nextOpenWindow` returns) — it must be formatted with `timeZone: 'UTC'` or
 * the VIEWER'S OWN browser timezone would shift it, showing the wrong day
 * for anyone west of Belize. This is the same off-by-one class BMPL-283
 * found; the fix there was re-anchoring an INPUT before it became an
 * instant, the fix here is formatting this OUTPUT without ever turning it
 * into one. Do not swap this for a plain `toLocaleDateString()` — that
 * reads the browser's local zone by default and would reintroduce exactly
 * this bug for any viewer not in Belize's own zone.
 */
function formatCalendarDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

export interface VendorClosingSoonWarning {
  message: string;
}

/**
 * Edward REQ 5: the case `vendorClosedBadge` deliberately does not cover — a
 * vendor who is open RIGHT NOW but whose configured hours say they will close
 * before this order's estimated delivery window is over.
 *
 * Same absolute rule as the closed badge (owner ruling 10): hours CONSTRAIN
 * DISPATCH, they do not block ordering, so this never says or implies the
 * order cannot be placed — only that it may be delivered after they've
 * reopened. And the same "no configured hours -> no warning at all" default:
 * an unconfigured vendor is unconstrained, not a vendor about whom nothing
 * can be promised.
 *
 * Mutually exclusive with the closed badge by construction: if the vendor is
 * already closed, THAT is the relevant fact and this returns null — "closing
 * soon" only makes sense for a vendor who is still open right now.
 *
 * `estimatedArrival` is computed by the caller from the vendor's own
 * configured `DeliveryEstimate` (never invented here) — conventionally
 * `now + estimate.maxHours`, the worst case, so this warns on any chance of
 * closing before arrival rather than only a certainty. No estimate configured
 * means no arrival to compare against, so the caller should not call this at
 * all in that case (there's nothing to warn about).
 */
export function vendorClosingSoonWarning(
  weeklyHours: readonly VendorWeeklyHour[],
  exceptions: readonly VendorHoursExceptionPublic[],
  now: Date,
  estimatedArrival: Date,
): VendorClosingSoonWarning | null {
  if (weeklyHours.length === 0 && exceptions.length === 0) return null;

  const weeklyPattern: WeeklyOpeningHours[] = weeklyHours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    openTime: h.openTime,
    closeTime: h.closeTime,
    isClosed: h.isClosed,
  }));
  // Same no-Belize-shift parsing as vendorClosedBadge — see its own comment.
  const hoursExceptions: HoursException[] = exceptions.map((e) => ({
    date: new Date(e.date),
    status: e.status,
    openTime: e.openTime,
    closeTime: e.closeTime,
  }));

  const nowResolution = resolveHoursStatus(now, weeklyPattern, hoursExceptions);
  if (!nowResolution.isOpen) return null; // already closed — vendorClosedBadge's job, not this one.

  const arrivalResolution = resolveHoursStatus(estimatedArrival, weeklyPattern, hoursExceptions);
  if (arrivalResolution.isOpen) return null; // still open by the time it's expected to arrive.

  const closesAt = nowResolution.closeTime ? ` at ${nowResolution.closeTime}` : '';
  return {
    message: `Open now, but may close${closesAt} before your order is expected to arrive. It will still be delivered once they reopen.`,
  };
}
