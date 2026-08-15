import { describe, expect, it } from 'vitest';
import {
  BELIZE_BOUNDS,
  formatCoordinates,
  isFiniteCoordinate,
  isWithinBelize,
  mapsDirectionsUrl,
  mapsNavigationUrl,
} from './geo';

const BELIZE_CITY = { latitude: 17.4995, longitude: -88.1976 };

describe('isWithinBelize', () => {
  it('accepts real places in Belize', () => {
    for (const [name, c] of Object.entries({
      'Belize City': BELIZE_CITY,
      Belmopan: { latitude: 17.2514, longitude: -88.7705 },
      'San Ignacio': { latitude: 17.1561, longitude: -89.0714 },
      'Punta Gorda': { latitude: 16.0996, longitude: -88.8079 },
      'Corozal Town': { latitude: 18.3958, longitude: -88.3886 },
      'Ambergris Caye': { latitude: 17.9167, longitude: -87.9667 },
      'Half Moon Caye': { latitude: 17.2, longitude: -87.535 },
    })) {
      expect(isWithinBelize(c.latitude, c.longitude), name).toBe(true);
    }
  });

  it('rejects coordinates outside the country', () => {
    for (const [name, c] of Object.entries({
      London: { latitude: 51.5074, longitude: -0.1278 },
      'Null Island': { latitude: 0, longitude: 0 },
      'Mexico City': { latitude: 19.4326, longitude: -99.1332 },
      'Guatemala City': { latitude: 14.6349, longitude: -90.5069 },
      'mid-Atlantic': { latitude: 17.5, longitude: -40 },
      // Latitude and longitude transposed — the single most likely mistake, and
      // it passes a naive -90..90 / -180..180 check.
      transposed: { latitude: -88.1976, longitude: 17.4995 },
    })) {
      expect(isWithinBelize(c.latitude, c.longitude), name).toBe(false);
    }
  });

  it('rejects anything that is not a finite number', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '17.5', {}, []]) {
      expect(isWithinBelize(bad, -88.2), String(bad)).toBe(false);
      expect(isWithinBelize(17.5, bad), String(bad)).toBe(false);
    }
  });

  it('treats the bounds themselves as inclusive', () => {
    const { minLatitude, maxLatitude, minLongitude, maxLongitude } = BELIZE_BOUNDS;
    expect(isWithinBelize(minLatitude, minLongitude)).toBe(true);
    expect(isWithinBelize(maxLatitude, maxLongitude)).toBe(true);
    expect(isWithinBelize(minLatitude - 0.0001, minLongitude)).toBe(false);
    expect(isWithinBelize(maxLatitude, maxLongitude + 0.0001)).toBe(false);
  });
});

describe('isFiniteCoordinate', () => {
  it('separates "not a number" from "not in Belize"', () => {
    expect(isFiniteCoordinate(51.5, -0.12)).toBe(true); // London: finite, just elsewhere
    expect(isWithinBelize(51.5, -0.12)).toBe(false);
    expect(isFiniteCoordinate(NaN, -88)).toBe(false);
  });
});

describe('maps links', () => {
  it('builds a keyless universal maps URL', () => {
    const url = mapsNavigationUrl(BELIZE_CITY);
    expect(url).toBe('https://www.google.com/maps?q=17.4995%2C-88.1976');
    // No API key, no SDK, nothing billable.
    expect(url).not.toMatch(/key=|apiKey|client=/);
  });

  it('appends a label without letting it break the query', () => {
    const url = mapsNavigationUrl(BELIZE_CITY, 'Order (TEST) #12');
    expect(decodeURIComponent(url)).toContain('17.4995,-88.1976');
    expect(decodeURIComponent(url)).toContain('Order TEST #12'); // parens stripped
  });

  it('caps a long label rather than building an enormous URL', () => {
    const url = mapsNavigationUrl(BELIZE_CITY, 'x'.repeat(500));
    expect(url.length).toBeLessThan(200);
  });

  it('offers turn-by-turn directions from wherever the device is', () => {
    expect(mapsDirectionsUrl(BELIZE_CITY)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=17.4995%2C-88.1976',
    );
  });
});

describe('formatCoordinates', () => {
  it('is precise enough for any GPS fix and no more', () => {
    expect(formatCoordinates(BELIZE_CITY)).toBe('17.499500, -88.197600');
  });
});
