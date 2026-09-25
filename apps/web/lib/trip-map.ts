/**
 * Which pins a courier job can honestly put on a map — BMPL-136.
 *
 * The server decides what geography a driver may see (shipment-driver.service
 * `serialize`): a terminal end always carries its pin (a terminal is a public
 * place), a door end carries one only after acceptance. This module renders
 * exactly what arrives and nothing else — no geocoding, no guessed
 * coordinates, and no route line between pins, because no routing engine
 * exists and a drawn line would claim a road we know nothing about.
 */

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface PlaceLike {
  name: string | null;
  area: string | null;
  pinnedLocation?: { latitude: number; longitude: number } | null;
}

function point(place: PlaceLike | null | undefined, role: string): MapPoint | null {
  const pin = place?.pinnedLocation;
  if (!pin || !Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return null;
  const where = place?.name ?? place?.area;
  return { latitude: pin.latitude, longitude: pin.longitude, label: where ? `${role}: ${where}` : role };
}

/**
 * The pins the payload actually contains, labelled with the job's own words —
 * in whatever order the stops arrive: first is the collection, last is the
 * delivery, and anything in between (BMPL-190: a real hub the shipment
 * actually routes through, never invented) is "Via". A two-stop leg — the
 * original BMPL-136 shape — is just the no-middle case of this, not a
 * different function.
 */
export function tripMapPoints(stops: Array<PlaceLike | null | undefined>): MapPoint[] {
  return stops
    .map((place, i) => point(place, i === 0 ? 'Collect' : i === stops.length - 1 ? 'Deliver' : 'Via'))
    .filter((p): p is MapPoint => p !== null);
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
