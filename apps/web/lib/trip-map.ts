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

/** The pins the payload actually contains, labelled with the job's own words. */
export function tripMapPoints(pickup: PlaceLike | null, dropoff: PlaceLike | null): MapPoint[] {
  return [point(pickup, 'Collect'), point(dropoff, 'Deliver')].filter((p): p is MapPoint => p !== null);
}
