import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

/** One Nominatim-shaped row. */
const row = (lat: number, lon: number, name = 'Somewhere, Belize') => ({
  display_name: name,
  lat: String(lat),
  lon: String(lon),
  importance: 0.5,
});

function mockFetch(payload: unknown, ok = true) {
  const spy = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => payload });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GeocodingService', () => {
  it('returns Belize matches', async () => {
    mockFetch([row(17.4995, -88.1976, '12 Freetown Road, Belize City')]);
    const out = await new GeocodingService().search('12 Freetown Road');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ latitude: 17.4995, longitude: -88.1976 });
  });

  it('drops any result outside Belize, whatever the upstream says', async () => {
    // `bounded=1` should prevent this, but the coordinate that reaches the
    // customer's map must satisfy the same rule the checkout validator applies —
    // otherwise the map could hand them a pin the server would then reject.
    mockFetch([
      row(51.5074, -0.1278, 'London'),
      row(17.4995, -88.1976, 'Belize City'),
      row(0, 0, 'Null Island'),
    ]);
    const out = await new GeocodingService().search('anywhere');
    expect(out.map((r) => r.label)).toEqual(['Belize City']);
  });

  it('writes the district as a readable label, not the raw enum', async () => {
    const spy = mockFetch([]);
    await new GeocodingService().search('4 Vista Del Mar', 'ORANGE_WALK');
    expect(new URL(String(spy.mock.calls[0]![0])).searchParams.get('q')).toBe('4 Vista Del Mar, Orange Walk, Belize');
  });

  it('scopes the query to Belize and the shared bounding box', async () => {
    const spy = mockFetch([]);
    await new GeocodingService().search('4 Vista Del Mar', 'BELIZE');
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toContain('countrycodes=bz');
    expect(url).toContain('bounded=1');
    expect(url).toContain('viewbox=');
    // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone.
    const q = new URL(url).searchParams.get('q');
    expect(q).toBe('4 Vista Del Mar, Belize, Belize');
  });

  it('identifies the application, as OpenStreetMap policy requires', async () => {
    const spy = mockFetch([]);
    await new GeocodingService().search('somewhere');
    const headers = (spy.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers['User-Agent']).toContain('BelizeMarketplaceLogistics');
    expect(headers['User-Agent']).toContain('bzemarketplace.com');
  });

  it('does not call out at all for a too-short query', async () => {
    const spy = mockFetch([row(17.5, -88.2)]);
    expect(await new GeocodingService().search('ab')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('caches a repeated lookup instead of spending the shared quota twice', async () => {
    const spy = mockFetch([row(17.4995, -88.1976)]);
    const svc = new GeocodingService();
    await svc.search('12 Freetown Road', 'BELIZE');
    await svc.search('12 Freetown Road', 'BELIZE');
    await svc.search('  12   FREETOWN road ', 'BELIZE'); // normalised to the same key
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces an upstream outage as "place the pin yourself", not a crash', async () => {
    mockFetch(null, false);
    await expect(new GeocodingService().search('anywhere')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps serving after a failure — the queue is not poisoned', async () => {
    const svc = new GeocodingService();
    mockFetch(null, false);
    await expect(svc.search('first')).rejects.toBeInstanceOf(ServiceUnavailableException);
    mockFetch([row(17.4995, -88.1976, 'Belize City')]);
    await expect(svc.search('second')).resolves.toHaveLength(1);
  });
});
