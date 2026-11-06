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
  /** ADDRESS (a door) vs HUB (a terminal) — lets the map draw them differently. Absent on an older/non-shipment caller. */
  kind?: 'ADDRESS' | 'HUB';
}

interface PlaceLike {
  name: string | null;
  area: string | null;
  kind?: 'ADDRESS' | 'HUB';
  pinnedLocation?: { latitude: number; longitude: number } | null;
}

function pinOf(place: PlaceLike | null | undefined): { latitude: number; longitude: number } | null {
  const pin = place?.pinnedLocation;
  if (!pin || !Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return null;
  return pin;
}

/** Same pin (both come from the same server-sent record — exact equality, no epsilon needed). */
function samePin(
  a: { latitude: number; longitude: number } | null,
  b: { latitude: number; longitude: number } | null,
): boolean {
  return a != null && b != null && a.latitude === b.latitude && a.longitude === b.longitude;
}

/**
 * The pins the payload actually contains, labelled with the job's own words.
 *
 * SHIP-C: `myEnds`, when given, names the leg's OWN pickup and dropoff place
 * — exactly `job.pickup`/`job.dropoff`, the two points this driver is
 * actually responsible for. A stop is "Collect" or "Deliver" only when its
 * pin matches one of those two; everything else is "Via", regardless of
 * where it sits in the array. Without `myEnds` (the two-stop marketplace
 * caller, which has no other-leg stops to confuse this with), role falls
 * back to position: first visible is Collect, last is Deliver, anything
 * between is Via — the original BMPL-136/190/198 behaviour, unchanged.
 *
 * Why position alone is wrong for a multi-leg shipment route: `routeStops`
 * spans the WHOLE shipment, sender door to recipient door, across every leg
 * — not just this driver's own. A LAST_MILE driver's own pickup is THEIR
 * origin hub, which can be the second or third hub in that full chain, not
 * the first one a position-based "first visible stop" would grab; the
 * mirror mistake hits a FIRST_MILE driver's "Deliver". Matching by pin
 * against this driver's own two points is immune to how many other legs'
 * hubs sit before or after them.
 */
export function tripMapPoints(
  stops: Array<PlaceLike | null | undefined>,
  myEnds?: { pickup?: PlaceLike | null; dropoff?: PlaceLike | null },
): MapPoint[] {
  const visible = stops
    .map((place) => {
      const pin = pinOf(place);
      return pin ? { place, pin } : null;
    })
    .filter((v): v is { place: PlaceLike | null | undefined; pin: { latitude: number; longitude: number } } => v !== null);

  const pickupPin = myEnds ? pinOf(myEnds.pickup) : null;
  const dropoffPin = myEnds ? pinOf(myEnds.dropoff) : null;

  return visible.map(({ place, pin }, i) => {
    const role = myEnds
      ? samePin(pin, pickupPin)
        ? 'Collect'
        : samePin(pin, dropoffPin)
          ? 'Deliver'
          : 'Via'
      : i === 0
        ? 'Collect'
        : i === visible.length - 1
          ? 'Deliver'
          : 'Via';
    const where = place?.name ?? place?.area;
    return {
      latitude: pin.latitude,
      longitude: pin.longitude,
      label: where ? `${role}: ${where}` : role,
      kind: place?.kind,
    };
  });
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
