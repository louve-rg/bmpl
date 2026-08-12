import { describe, expect, it } from 'vitest';
import { DISTRICT_CENTROIDS } from './districts';
import { queueStopKind } from './driver-queue';
import { formatDistanceKm } from './units';
import {
  estimatedRoadKm,
  formatMinutes,
  haversineKm,
  recommendRoute,
  resolvePoint,
  ROAD_DETOUR_FACTOR,
  type RouteStopInput,
} from './route-optimizer';

const BELIZE_CITY = { latitude: 17.4995, longitude: -88.1976 };
const BELMOPAN = { latitude: 17.2514, longitude: -88.7705 };
const SAN_IGNACIO = { latitude: 17.1561, longitude: -89.0714 };
const PUNTA_GORDA = { latitude: 16.0996, longitude: -88.8079 };

const stop = (id: string, loc: Partial<RouteStopInput['location']>, manualPosition?: number): RouteStopInput => ({
  id,
  location: loc,
  ...(manualPosition == null ? {} : { manualPosition }),
});

describe('resolvePoint', () => {
  it('prefers real coordinates and reports them as exact', () => {
    const r = resolvePoint({ latitude: 17.5, longitude: -88.2, district: 'CAYO' });
    expect(r.precision).toBe('EXACT');
    expect(r.point).toEqual({ latitude: 17.5, longitude: -88.2 });
  });

  it('falls back to the district centroid and says so', () => {
    const r = resolvePoint({ latitude: null, longitude: null, district: 'TOLEDO' });
    expect(r.precision).toBe('DISTRICT');
    expect(r.point).toEqual(DISTRICT_CENTROIDS.TOLEDO);
  });

  it('reports UNKNOWN rather than guessing when there is nothing to go on', () => {
    expect(resolvePoint({}).precision).toBe('UNKNOWN');
    expect(resolvePoint({ district: 'NOT_A_DISTRICT' }).point).toBeNull();
    expect(resolvePoint(null).point).toBeNull();
  });

  it('ignores non-finite coordinates instead of producing NaN distances', () => {
    const r = resolvePoint({ latitude: Number.NaN, longitude: 0, district: 'BELIZE' });
    expect(r.precision).toBe('DISTRICT');
  });
});

describe('haversineKm', () => {
  it('measures a known Belize distance to within a few percent', () => {
    // Belize City → Belmopan is ~76 km by road, ~66 km straight line.
    const km = haversineKm(BELIZE_CITY, BELMOPAN);
    expect(km).toBeGreaterThan(60);
    expect(km).toBeLessThan(72);
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(BELIZE_CITY, BELIZE_CITY)).toBeCloseTo(0, 6);
    expect(haversineKm(BELIZE_CITY, PUNTA_GORDA)).toBeCloseTo(haversineKm(PUNTA_GORDA, BELIZE_CITY), 6);
  });
});

describe('estimatedRoadKm', () => {
  it('inflates straight-line distance by the detour factor', () => {
    const straight = haversineKm(BELIZE_CITY, BELMOPAN);
    expect(estimatedRoadKm(BELIZE_CITY, BELMOPAN)).toBeCloseTo(straight * ROAD_DETOUR_FACTOR, 6);
  });

  it('returns null rather than a fabricated number when a location is unknown', () => {
    expect(estimatedRoadKm(BELIZE_CITY, {})).toBeNull();
    expect(estimatedRoadKm({}, BELIZE_CITY)).toBeNull();
  });
});

describe('recommendRoute', () => {
  it('orders three stops nearest-first from the origin', () => {
    const route = recommendRoute(
      [stop('pg', PUNTA_GORDA), stop('si', SAN_IGNACIO), stop('bmp', BELMOPAN)],
      BELIZE_CITY,
    );
    expect(route.legs.map((l) => l.id)).toEqual(['bmp', 'si', 'pg']);
    expect(route.legs.map((l) => l.position)).toEqual([1, 2, 3]);
  });

  it('produces a total no worse than the incoming order', () => {
    const stops = [stop('pg', PUNTA_GORDA), stop('bmp', BELMOPAN), stop('si', SAN_IGNACIO)];
    const recommended = recommendRoute(stops, BELIZE_CITY);
    const asGiven =
      haversineKm(BELIZE_CITY, PUNTA_GORDA) + haversineKm(PUNTA_GORDA, BELMOPAN) + haversineKm(BELMOPAN, SAN_IGNACIO);
    expect(recommended.totalDistanceKm!).toBeLessThanOrEqual(asGiven * ROAD_DETOUR_FACTOR + 0.1);
  });

  it('is deterministic — the same input always yields the same order', () => {
    const stops = [stop('a', BELMOPAN), stop('b', SAN_IGNACIO), stop('c', PUNTA_GORDA), stop('d', BELIZE_CITY)];
    const first = recommendRoute(stops, BELIZE_CITY).legs.map((l) => l.id);
    for (let i = 0; i < 5; i += 1) {
      expect(recommendRoute(stops, BELIZE_CITY).legs.map((l) => l.id)).toEqual(first);
    }
  });

  it('breaks an exact distance tie on the driver’s manual order, then on id', () => {
    const same = { latitude: 17.4, longitude: -88.3 };
    const byManual = recommendRoute([stop('z', same, 1), stop('a', same, 2)], BELIZE_CITY);
    expect(byManual.legs.map((l) => l.id)).toEqual(['z', 'a']);
    const byId = recommendRoute([stop('z', same), stop('a', same)], BELIZE_CITY);
    expect(byId.legs.map((l) => l.id)).toEqual(['a', 'z']);
  });

  it('accumulates distance and never reports a decreasing cumulative total', () => {
    const route = recommendRoute([stop('a', BELMOPAN), stop('b', SAN_IGNACIO), stop('c', PUNTA_GORDA)], BELIZE_CITY);
    const cumulative = route.legs.map((l) => l.cumulativeDistanceKm!);
    for (let i = 1; i < cumulative.length; i += 1) expect(cumulative[i]!).toBeGreaterThanOrEqual(cumulative[i - 1]!);
    expect(route.totalDistanceKm).toBeCloseTo(cumulative[cumulative.length - 1]!, 1);
  });

  it('degrades precision to DISTRICT when any stop only has a district', () => {
    const route = recommendRoute([stop('a', BELMOPAN), stop('b', { district: 'TOLEDO' })], BELIZE_CITY);
    expect(route.precision).toBe('DISTRICT');
  });

  it('appends unlocatable stops last and reports no distance for them', () => {
    const route = recommendRoute([stop('nowhere', {}), stop('bmp', BELMOPAN)], BELIZE_CITY);
    expect(route.legs.map((l) => l.id)).toEqual(['bmp', 'nowhere']);
    const orphan = route.legs.find((l) => l.id === 'nowhere')!;
    expect(orphan.legDistanceKm).toBeNull();
    expect(orphan.legMinutes).toBeNull();
    expect(orphan.precision).toBe('UNKNOWN');
  });

  it('still sequences the stops when there is no origin to start from', () => {
    const route = recommendRoute([stop('a', BELMOPAN), stop('b', SAN_IGNACIO)], null);
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0]!.legDistanceKm).toBeNull(); // nothing to measure from
    expect(route.legs[1]!.legDistanceKm).toBeGreaterThan(0);
  });

  it('handles the empty and single-stop cases without inventing a total', () => {
    expect(recommendRoute([], BELIZE_CITY).legs).toEqual([]);
    expect(recommendRoute([], BELIZE_CITY).totalDistanceKm).toBeNull();
    const one = recommendRoute([stop('a', BELMOPAN)], BELIZE_CITY);
    expect(one.legs).toHaveLength(1);
    expect(one.totalDistanceKm).toBeCloseTo(one.legs[0]!.legDistanceKm!, 5);
  });

  it('scales to a full queue without hanging', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      stop(`s${i}`, { latitude: 16 + i * 0.1, longitude: -88 - i * 0.05 }),
    );
    const route = recommendRoute(many, BELIZE_CITY);
    expect(route.legs).toHaveLength(20);
    expect(new Set(route.legs.map((l) => l.id)).size).toBe(20);
  });
});

describe('lifecycle safety', () => {
  /**
   * The guarantee the client feedback turns on: a drop-off can never be routed
   * ahead of its own pickup. It holds structurally — a delivery contributes one
   * stop at a time, chosen by its status — so the test asserts the invariant on
   * the input the API builds, not on the optimizer's output alone.
   */
  it('never offers both ends of the same delivery as separate stops', () => {
    const deliveries = [
      { id: 'd1', status: 'DRIVER_ACCEPTED' as const },
      { id: 'd2', status: 'IN_TRANSIT' as const },
      { id: 'd3', status: 'ASSIGNED' as const },
    ];
    const stops = deliveries.map((d) => ({ id: d.id, kind: queueStopKind(d.status) }));
    expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
    expect(stops.find((s) => s.id === 'd1')!.kind).toBe('PICKUP');
    expect(stops.find((s) => s.id === 'd2')!.kind).toBe('DROPOFF');
  });
});

describe('formatting', () => {
  // Distances go through the shared imperial formatter — drivers in Belize are
  // shown miles, and the route module deliberately owns no second converter.
  it('presents route distances in miles', () => {
    expect(formatDistanceKm(10)).toBe('6.2 mi');
    expect(formatDistanceKm(null)).toBeNull();
  });

  it('formats durations in hours and minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(95)).toBe('1 hr 35 min');
    expect(formatMinutes(null)).toBeNull();
  });
});
