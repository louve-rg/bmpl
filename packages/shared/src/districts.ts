/** The six districts of Belize. Mirrors the Prisma `District` enum. */
export const DISTRICTS = [
  'BELIZE',
  'CAYO',
  'COROZAL',
  'ORANGE_WALK',
  'STANN_CREEK',
  'TOLEDO',
] as const;

export type District = (typeof DISTRICTS)[number];

export const DISTRICT_LABELS: Record<District, string> = {
  BELIZE: 'Belize',
  CAYO: 'Cayo',
  COROZAL: 'Corozal',
  ORANGE_WALK: 'Orange Walk',
  STANN_CREEK: 'Stann Creek',
  TOLEDO: 'Toledo',
};

/**
 * Approximate centroid of each district, used ONLY as a coarse fallback when a
 * row carries no coordinates of its own.
 *
 * These are public geographic facts, not customer data, and they are deliberately
 * coarse: a district centroid answers "is this drop an hour away or five minutes
 * away?" and nothing finer. Anything derived from them must be labelled as an
 * estimate — see `route-optimizer.ts`, which reports `precision: 'DISTRICT'`
 * whenever one of these stands in for a real coordinate.
 */
export const DISTRICT_CENTROIDS: Record<District, { latitude: number; longitude: number }> = {
  BELIZE: { latitude: 17.55, longitude: -88.35 },
  CAYO: { latitude: 17.1, longitude: -88.95 },
  COROZAL: { latitude: 18.3, longitude: -88.45 },
  ORANGE_WALK: { latitude: 17.95, longitude: -88.85 },
  STANN_CREEK: { latitude: 16.85, longitude: -88.4 },
  TOLEDO: { latitude: 16.2, longitude: -88.9 },
};

/** Narrow an arbitrary string to a District, or null. */
export function asDistrict(value: string | null | undefined): District | null {
  return value != null && (DISTRICTS as readonly string[]).includes(value) ? (value as District) : null;
}
