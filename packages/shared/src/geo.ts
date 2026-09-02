/**
 * Geographic bounds and external-navigation links.
 *
 * Two jobs that both need to agree between the browser and the server:
 *
 *  1. Is this coordinate plausibly in Belize? The checkout map can be told to
 *     drop a pin anywhere on earth, and a request body can claim anything at
 *     all. A coordinate in the Pacific would sail through the generic
 *     lat/lng range check, be snapshotted onto the order, and then poison the
 *     route recommendation for every other stop in the driver's queue. The
 *     server is the authority; the client uses the same function only so the
 *     customer finds out before they submit.
 *
 *  2. Where does "Open in Maps" point? A plain URL to the user's own maps
 *     application. This deliberately does NOT integrate a mapping API — no key,
 *     no billing, and the driver gets real turn-by-turn in the app they already
 *     use.
 */

/**
 * Belize's national bounding box, padded slightly to the cays and the reef.
 *
 * Mainland Belize spans roughly 15.89–18.50 N and 89.23–87.48 W. The east edge
 * is pushed to −87.3 to take in Lighthouse Reef and Half Moon Caye, which are
 * genuinely deliverable and would otherwise be rejected. This is a sanity
 * boundary, not a border: it exists to catch nonsense, not to adjudicate
 * territory.
 */
export const BELIZE_BOUNDS = {
  minLatitude: 15.8,
  maxLatitude: 18.55,
  minLongitude: -89.3,
  maxLongitude: -87.3,
} as const;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Is this a finite, real-numbered coordinate pair at all? */
export function isFiniteCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

/** Is this coordinate inside the Belize bounding box? */
export function isWithinBelize(latitude: unknown, longitude: unknown): boolean {
  if (!isFiniteCoordinate(latitude, longitude)) return false;
  const lat = latitude as number;
  const lng = longitude as number;
  return (
    lat >= BELIZE_BOUNDS.minLatitude &&
    lat <= BELIZE_BOUNDS.maxLatitude &&
    lng >= BELIZE_BOUNDS.minLongitude &&
    lng <= BELIZE_BOUNDS.maxLongitude
  );
}

/**
 * The message shown when an address can be neither read nor navigated to.
 *
 * A delivery endpoint has to be findable ONE of two ways: written down, or
 * pinned. Requiring both is what made "drop a pin" pointless — the customer
 * showed us the exact doorstep and was then told the address was missing. Either
 * one alone is a complete answer, and this sentence names both ways out rather
 * than saying "address required" at someone who has already supplied a pin.
 */
export const UNLOCATABLE_ADDRESS_MESSAGE =
  'Tell us where to go: type the street address, or drop a pin on the map.';

/** The message shown when a pin lands outside Belize. Shared so both surfaces agree. */
export const OUT_OF_BOUNDS_MESSAGE = 'That location is outside Belize. Move the pin to your delivery address.';

/** Rounded for display; six decimals is ~0.1 m, far beyond what any phone GPS knows. */
export function formatCoordinates({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/**
 * A link that opens the coordinate in whatever maps application the device
 * uses — Google Maps on Android, Apple Maps or Google Maps on iOS, a browser
 * map on desktop.
 *
 * `?q=lat,lng` is the long-standing universal form and needs no API key,
 * no SDK and no billing account. `label` is appended only as a display name;
 * the coordinate is what actually drives the pin, so a missing or odd label
 * can never send the driver to the wrong place.
 */
export function mapsNavigationUrl({ latitude, longitude }: Coordinates, label?: string | null): string {
  const q = `${latitude},${longitude}`;
  const suffix = label ? `(${label.replace(/[()]/g, '').slice(0, 60)})` : '';
  return `https://www.google.com/maps?q=${encodeURIComponent(q + suffix)}`;
}

/** Turn-by-turn directions to the coordinate from wherever the device is now. */
export function mapsDirectionsUrl({ latitude, longitude }: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/**
 * A snapshotted delivery address as the lines you would read out loud.
 *
 * One helper because a delivery address is now allowed to have NO street line —
 * the customer dropped a pin instead of typing one — and three separate screens
 * rendering `{address.addressLine1}` would each print an empty line, or the word
 * "null", on exactly the orders that are hardest to deliver.
 *
 * A missing street is stated rather than hidden. An operator reading an order
 * with a blank first line cannot tell whether the address is pinned or the data
 * is broken, and those want very different responses. The schema guarantees the
 * pin is there when the street is not, so saying so is a fact and not a guess.
 */
export function addressLines(a: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city: string;
  district: string;
  country?: string | null;
}): string[] {
  const street = [a.addressLine1, a.addressLine2].filter((x) => !!x?.trim()).join(', ');
  const locality = [a.city, a.district.replace(/_/g, ' '), a.country].filter(Boolean).join(', ');
  return [street || 'Pinned on the map — no street address given', locality];
}
