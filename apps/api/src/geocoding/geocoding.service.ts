import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { BELIZE_BOUNDS, DISTRICT_LABELS, asDistrict, isWithinBelize } from '@bmpl/shared';

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  /** Nominatim's own confidence-ish ordering; higher is a better match. */
  importance: number;
}

/** Nominatim asks callers to identify themselves and to keep it to ~1 req/sec. */
const USER_AGENT = 'BelizeMarketplaceLogistics/1.0 (+https://www.bzemarketplace.com)';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
/** Nominatim's published limit is 1/sec. Stay comfortably under it. */
const MIN_INTERVAL_MS = 1200;

/**
 * Turn a typed Belize address into map coordinates.
 *
 * WHY IT IS PROXIED rather than called from the browser: OpenStreetMap's
 * Nominatim requires callers to identify themselves with a real User-Agent and
 * to stay near one request per second. A browser cannot set User-Agent, and
 * thousands of customers each calling it directly is precisely the abuse the
 * policy exists to prevent. Going through here lets us identify the app, cache
 * repeated lookups, and serialise requests.
 *
 * HONEST ABOUT COVERAGE: OpenStreetMap's address data for Belize is patchy.
 * Plenty of genuine addresses will not be found, which is exactly why this is a
 * CONVENIENCE that moves the map, and the customer's dropped PIN remains the
 * authoritative location. A failed lookup is never an error the customer has to
 * resolve — it just means they place the pin themselves.
 *
 * No API key, no billing account, nothing paid.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();
  /** Serialises outbound calls so we never exceed Nominatim's rate policy. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  async search(query: string, district?: string): Promise<GeocodeResult[]> {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (q.length < 3) return [];

    const key = `${q.toLowerCase()}|${district ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

    let results: GeocodeResult[];
    try {
      results = await this.enqueue(() => this.callNominatim(q, district));
    } catch (err) {
      // A geocoding outage must not break checkout. The customer can still drop
      // the pin, which is the authoritative mechanism anyway.
      this.logger.warn(`geocode failed for "${q}": ${String(err)}`);
      throw new ServiceUnavailableException('Address lookup is unavailable right now. Place the pin on the map instead.');
    }

    if (this.cache.size >= CACHE_MAX) {
      // Cheap eviction: drop the oldest inserted key.
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), results });
    return results;
  }

  /** Run `fn` after the minimum interval since the previous outbound call. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      return fn();
    });
    // Keep the chain alive even when a call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async callNominatim(q: string, district?: string): Promise<GeocodeResult[]> {
    // "4 Vista Del Mar, Orange Walk, Belize" reads far better to a geocoder than
    // the raw enum "ORANGE_WALK", and matches how the district is written on a map.
    const districtLabel = asDistrict(district ?? null) ? DISTRICT_LABELS[asDistrict(district!)!] : null;
    const params = new URLSearchParams({
      q: districtLabel ? `${q}, ${districtLabel}, Belize` : `${q}, Belize`,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
      // Belize only, and bounded to the same box the pin validator uses so a
      // result can never sit outside what the server would accept.
      countrycodes: 'bz',
      bounded: '1',
      viewbox: [
        BELIZE_BOUNDS.minLongitude,
        BELIZE_BOUNDS.maxLatitude,
        BELIZE_BOUNDS.maxLongitude,
        BELIZE_BOUNDS.minLatitude,
      ].join(','),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const body = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string; importance?: number }>;
      return body
        .map((r) => ({
          label: String(r.display_name ?? '').slice(0, 200),
          latitude: Number(r.lat),
          longitude: Number(r.lon),
          importance: Number(r.importance ?? 0),
        }))
        // Defence in depth: `bounded=1` should already guarantee this, but the
        // coordinate that reaches the customer's map must satisfy the same rule
        // the checkout validator applies.
        .filter((r) => r.label && isWithinBelize(r.latitude, r.longitude));
    } finally {
      clearTimeout(timer);
    }
  }
}
