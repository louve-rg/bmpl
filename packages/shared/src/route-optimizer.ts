/**
 * Deterministic route recommendation for a driver holding several deliveries.
 *
 * The client asked for "AI" that picks the best order to run multiple drops. What
 * they described is the travelling-salesman problem on a handful of stops, which
 * a language model would answer more slowly, less accurately and non-repeatably
 * than twenty lines of arithmetic. So this is plain geometry: nearest-neighbour
 * construction followed by a 2-opt improvement pass, both bounded and both
 * deterministic — the same queue always yields the same recommendation.
 *
 * WHAT THIS IS NOT: there is no live traffic feed, no road network and no routing
 * API in BML, so nothing here claims a real driving time. Distances are
 * great-circle, inflated by a fixed road factor, and every result carries the
 * `precision` of the worst input that fed it so the UI can say "estimated" and
 * mean it.
 *
 * LIFECYCLE SAFETY: the caller supplies ONE stop per delivery — the store while
 * the goods are still there, the customer once they have been collected (see
 * `queueStopKind` in driver-queue.ts). A delivery therefore cannot have its
 * drop-off sequenced before its own pickup, because its drop-off is not a
 * candidate stop until the pickup has happened. This module never reasons about
 * delivery status and cannot be made to violate the state machine by reordering.
 */

import { DISTRICT_CENTROIDS, asDistrict } from './districts';

/** How exact a coordinate is. Reported upward so estimates can be labelled honestly. */
export type GeoPrecision = 'EXACT' | 'DISTRICT' | 'UNKNOWN';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A location as BML actually stores it: coordinates if we have them, district if not. */
export interface LocationInput {
  latitude?: number | null;
  longitude?: number | null;
  district?: string | null;
}

export interface RouteStopInput {
  /** Stable identifier — the delivery id. Echoed back on the result. */
  id: string;
  location: LocationInput;
  /**
   * A driver's own manual ordering, when they have set one. Lower comes first.
   * Purely a tie-break/anchor for presentation; it never overrides the
   * recommendation, which is returned separately.
   */
  manualPosition?: number | null;
}

export interface RouteLeg {
  id: string;
  /** 1-based position in the recommended sequence. */
  position: number;
  /** Estimated road distance from the previous stop (or from the origin), in km. */
  legDistanceKm: number | null;
  /** Cumulative estimated road distance from the origin, in km. */
  cumulativeDistanceKm: number | null;
  /** Rough travel time for this leg, in minutes. Null when distance is unknown. */
  legMinutes: number | null;
  /** The weakest precision of the two endpoints of this leg. */
  precision: GeoPrecision;
}

export interface RouteRecommendation {
  legs: RouteLeg[];
  totalDistanceKm: number | null;
  totalMinutes: number | null;
  /** The weakest precision anywhere in the route — what the UI should disclose. */
  precision: GeoPrecision;
}

/**
 * Belize roads are not straight lines. 1.35 is a conventional detour factor for
 * mixed highway/town driving and is used only to stop straight-line distance from
 * reading as an achievable one.
 */
export const ROAD_DETOUR_FACTOR = 1.35;

/** Average door-to-door speed including stops, km/h. A planning figure, not a promise. */
export const AVERAGE_SPEED_KMH = 40;

/** Handling time added per stop (park, find the door, hand over), in minutes. */
export const STOP_SERVICE_MINUTES = 6;

/** Above this many stops the 2-opt pass is skipped; nearest-neighbour alone is used. */
const TWO_OPT_MAX_STOPS = 12;

const EARTH_RADIUS_KM = 6371;

/** Resolve a stored location to a point, degrading to the district centroid. */
export function resolvePoint(loc: LocationInput | null | undefined): { point: GeoPoint | null; precision: GeoPrecision } {
  if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
    return { point: { latitude: loc.latitude, longitude: loc.longitude }, precision: 'EXACT' };
  }
  const district = asDistrict(loc?.district ?? null);
  if (district) return { point: DISTRICT_CENTROIDS[district], precision: 'DISTRICT' };
  return { point: null, precision: 'UNKNOWN' };
}

/** Great-circle distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated ROAD distance between two stored locations, km. Null if unknowable. */
export function estimatedRoadKm(from: LocationInput | null | undefined, to: LocationInput | null | undefined): number | null {
  const a = resolvePoint(from).point;
  const b = resolvePoint(to).point;
  if (!a || !b) return null;
  return haversineKm(a, b) * ROAD_DETOUR_FACTOR;
}

/** Minutes for a road distance, including one stop's handling time. */
export function estimatedMinutes(km: number): number {
  return Math.round((km / AVERAGE_SPEED_KMH) * 60 + STOP_SERVICE_MINUTES);
}

const weakest = (a: GeoPrecision, b: GeoPrecision): GeoPrecision =>
  a === 'UNKNOWN' || b === 'UNKNOWN' ? 'UNKNOWN' : a === 'DISTRICT' || b === 'DISTRICT' ? 'DISTRICT' : 'EXACT';

/**
 * Recommend the order to work through `stops`.
 *
 * `origin` is where the driver is starting from. BML has no live GPS, so callers
 * pass the best legitimate proxy they have — typically the driver's home district
 * — or null, in which case the first stop is chosen by the caller's existing
 * order and the rest are chained from it.
 *
 * Stops whose location cannot be resolved at all keep their incoming relative
 * order and are appended at the end: guessing where they go would be worse than
 * admitting we do not know.
 */
export function recommendRoute(
  stops: readonly RouteStopInput[],
  origin: LocationInput | null = null,
): RouteRecommendation {
  const resolved = stops.map((s) => ({ ...s, ...resolvePoint(s.location) }));
  const locatable = resolved.filter((s) => s.point !== null) as Array<(typeof resolved)[number] & { point: GeoPoint }>;
  const unlocatable = resolved.filter((s) => s.point === null);

  const originResolved = resolvePoint(origin);
  const ordered = orderStops(locatable, originResolved.point);

  const legs: RouteLeg[] = [];
  let cumulative = 0;
  let previous: GeoPoint | null = originResolved.point;
  let previousPrecision: GeoPrecision = originResolved.point ? originResolved.precision : 'UNKNOWN';

  ordered.forEach((stop, i) => {
    const legKm = previous ? haversineKm(previous, stop.point) * ROAD_DETOUR_FACTOR : null;
    if (legKm != null) cumulative += legKm;
    legs.push({
      id: stop.id,
      position: i + 1,
      legDistanceKm: legKm == null ? null : round1(legKm),
      cumulativeDistanceKm: legKm == null ? null : round1(cumulative),
      legMinutes: legKm == null ? null : estimatedMinutes(legKm),
      precision: legKm == null ? 'UNKNOWN' : weakest(previousPrecision, stop.precision),
    });
    previous = stop.point;
    previousPrecision = stop.precision;
  });

  unlocatable.forEach((stop, i) => {
    legs.push({
      id: stop.id,
      position: ordered.length + i + 1,
      legDistanceKm: null,
      cumulativeDistanceKm: null,
      legMinutes: null,
      precision: 'UNKNOWN',
    });
  });

  const measured = legs.filter((l) => l.legDistanceKm != null);
  return {
    legs,
    totalDistanceKm: measured.length > 0 ? round1(cumulative) : null,
    totalMinutes: measured.length > 0 ? measured.reduce((sum, l) => sum + (l.legMinutes ?? 0), 0) : null,
    precision: legs.reduce<GeoPrecision>((acc, l) => weakest(acc, l.precision), legs.length > 0 ? 'EXACT' : 'UNKNOWN'),
  };
}

/* ------------------------------------------------------------- internals */

type Located<T> = T & { point: GeoPoint; manualPosition?: number | null };

/** Nearest-neighbour construction, then a bounded 2-opt clean-up. */
function orderStops<T extends { id: string }>(stops: Array<Located<T>>, origin: GeoPoint | null): Array<Located<T>> {
  if (stops.length <= 1) return [...stops];

  const remaining = [...stops];
  const route: Array<Located<T>> = [];
  let cursor = origin;

  while (remaining.length > 0) {
    let bestIndex = 0;
    if (cursor) {
      let bestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((candidate, i) => {
        const d = haversineKm(cursor as GeoPoint, candidate.point);
        // Deterministic tie-break: an equal-distance tie falls to the driver's own
        // manual position, then to the id, so the same queue never reshuffles
        // itself between two refreshes for no reason.
        if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && precedes(candidate, remaining[bestIndex]!))) {
          bestDistance = d;
          bestIndex = i;
        }
      });
    }
    const [next] = remaining.splice(bestIndex, 1);
    route.push(next!);
    cursor = next!.point;
  }

  return stops.length <= TWO_OPT_MAX_STOPS ? twoOpt(route, origin) : route;
}

function precedes(a: { manualPosition?: number | null; id: string }, b: { manualPosition?: number | null; id: string }): boolean {
  const am = a.manualPosition ?? Number.MAX_SAFE_INTEGER;
  const bm = b.manualPosition ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am < bm;
  return a.id < b.id;
}

/** Classic 2-opt: reverse any segment whose reversal shortens the path. */
function twoOpt<T extends { id: string }>(route: Array<Located<T>>, origin: GeoPoint | null): Array<Located<T>> {
  const path = [...route];
  const cost = (r: Array<Located<T>>): number => {
    let total = 0;
    let prev = origin;
    for (const stop of r) {
      if (prev) total += haversineKm(prev, stop.point);
      prev = stop.point;
    }
    return total;
  };

  let best = cost(path);
  let improved = true;
  // Bounded: n ≤ TWO_OPT_MAX_STOPS and at most n passes, so this is trivially
  // terminating even if floating-point noise made an "improvement" oscillate.
  let passes = 0;
  while (improved && passes < path.length) {
    improved = false;
    passes += 1;
    for (let i = 0; i < path.length - 1; i += 1) {
      for (let k = i + 1; k < path.length; k += 1) {
        const candidate = [...path.slice(0, i), ...path.slice(i, k + 1).reverse(), ...path.slice(k + 1)];
        const c = cost(candidate);
        if (c < best - 1e-9) {
          path.splice(0, path.length, ...candidate);
          best = c;
          improved = true;
        }
      }
    }
  }
  return path;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/* ------------------------------------------------------------- formatting */

/**
 * Human label for an estimated duration.
 *
 * Distances are NOT formatted here: BML shows users imperial units, and
 * `formatDistanceKm` in `units.ts` is the one place that conversion happens.
 * Every km figure this module produces goes through it before it is displayed.
 */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** The disclosure that must accompany any figure derived from this module. */
export const ROUTE_ESTIMATE_DISCLOSURE: Record<GeoPrecision, string> = {
  EXACT: 'Estimated from straight-line distance — not live traffic.',
  DISTRICT: 'Rough estimate from district locations — not live traffic.',
  UNKNOWN: 'No location data for some stops, so distances are unavailable.',
};
