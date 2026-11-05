/**
 * The shared point shape MapPreview draws, and the A/B/C… letters
 * ExpandableRouteMap-style legends attach to an ordered set of them.
 *
 * Ported from apps/web/lib/trip-map.ts (MDF-538): only `MapPoint`,
 * `stopLetter` and `labelStops` -- the framework-free, business-rule-free
 * shapes MapPreview.tsx actually needs. `tripMapPoints` (courier-job pin
 * visibility rules keyed on `pinnedLocation`/pre-acceptance gating) stays in
 * apps/web; it is driver-dispatch business logic, not a map primitive, and
 * admin's read-only previews don't have that gating to apply.
 */

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}

/**
 * A stop's letter in an ordered route (BMPL-182): A first, B, C… — whatever
 * letter the last stop actually reaches, never padded out to a fixed count.
 */
export function stopLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export type LabeledStop = MapPoint & { letter: string };

/** Attach each stop's route letter, in the order the points already arrived. */
export function labelStops(points: MapPoint[]): LabeledStop[] {
  return points.map((p, i) => ({ ...p, letter: stopLetter(i) }));
}
