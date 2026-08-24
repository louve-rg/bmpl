'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
// Leaflet's stylesheet. A static import is what Next expects; it is scoped to
// this component's chunk, which only the checkout route loads.
import 'leaflet/dist/leaflet.css';
import { BELIZE_BOUNDS, DISTRICT_CENTROIDS, OUT_OF_BOUNDS_MESSAGE, asDistrict, isWithinBelize, type Coordinates } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Button, Spinner } from '../ui';

interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
}

/** Belize City — where the map opens before the customer has done anything. */
const DEFAULT_CENTRE: Coordinates = { latitude: 17.4995, longitude: -88.1976 };
const DEFAULT_ZOOM = 13;
const PINNED_ZOOM = 17;

/** How long to wait for a GPS fix before telling the customer it isn't coming. */
const GEO_TIMEOUT_MS = 12_000;

/**
 * Accuracy bands, in metres.
 *
 * A phone with GPS typically reports single-digit to tens of metres. A desktop
 * has no GPS at all and derives position from Wi-Fi or IP, which is routinely
 * 100 m to several kilometres out — one tester saw "109 m" on a computer and a
 * few metres on their phone, and reasonably wondered whether the map was broken.
 * It was not: the browser was reporting an honest, and honestly vague, fix.
 *
 * So the number is always shown, and the wording changes with it. Anything
 * beyond GOOD_M asks the customer to check the pin rather than presenting the
 * result as their doorstep.
 */
const GOOD_ACCURACY_M = 25;
const FAIR_ACCURACY_M = 100;

type GeoState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'error'; message: string }
  | { kind: 'located'; accuracyM: number | null };

/** How to describe a reported accuracy, and whether to nudge for a correction. */
function describeAccuracy(m: number | null): { tone: 'success' | 'warning'; text: string; nudge: string | null } {
  if (m == null) return { tone: 'success', text: 'Location detected.', nudge: null };
  const rounded = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  if (m <= GOOD_ACCURACY_M) {
    return { tone: 'success', text: `Location detected — accurate to about ${rounded}.`, nudge: null };
  }
  if (m <= FAIR_ACCURACY_M) {
    return {
      tone: 'success',
      text: `Location detected — accurate to about ${rounded}.`,
      nudge: 'Worth a quick check — drag the pin if it isn’t quite on your door.',
    };
  }
  return {
    tone: 'warning',
    text: `Location detected — accurate to about ${rounded}.`,
    nudge:
      'Your device gave an approximate position — that is normal on a computer, which has no GPS. Drag the pin to your exact delivery point.',
  };
}

/**
 * Pick the exact delivery spot on a map, the way you'd share a location in a
 * messaging app.
 *
 * WHY THIS EXISTS: Belize street addresses are frequently not findable. "412
 * Hummingbird Highway Extension, behind the old bridge" is a real address and a
 * useless navigation target. A pin is unambiguous, and it also upgrades the
 * driver's route estimate from a district-centroid guess to a real distance.
 *
 * Leaflet + OpenStreetMap, deliberately: no API key, no billing account, no
 * per-load cost. Leaflet is imported dynamically inside an effect so neither it
 * nor its CSS reaches any other page's bundle — only the routes that actually
 * show a map (checkout, and the vendor's pickup locations) pay for it.
 *
 * The pin is OPTIONAL. A customer who refuses location permission, or whose GPS
 * fails, or who simply doesn't want to, completes checkout on the typed address
 * exactly as before. Nothing here is allowed to become a wall.
 */
export function LocationPicker({
  value,
  onChange,
  disabled,
  address,
  district,
  heading,
  hint,
  autoLocateAddress,
}: {
  value: Coordinates | null;
  onChange: (next: Coordinates | null) => void;
  disabled?: boolean;
  /** The typed street address, so the customer can find it on the map. */
  address?: string;
  /** The chosen district — the map follows it immediately, with no network call. */
  district?: string;
  /** Section heading. Defaults to the customer wording. */
  heading?: string;
  /** Explanatory line under the heading. Defaults to the customer wording. */
  hint?: string;
  /**
   * Look the typed address up automatically and drop a provisional pin.
   *
   * For forms where seeing the address on a map IS the point, rather than an
   * optional extra. The pin is still provisional and still draggable — this only
   * removes the step of asking the customer to press a button to see something
   * we could have shown them.
   */
  autoLocateAddress?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);
  /** The translucent "somewhere in here" circle drawn around a GPS fix. */
  const accuracyRef = useRef<LeafletNS.Circle | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  // Read inside the map callbacks without re-running the setup effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [ready, setReady] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [outOfBounds, setOutOfBounds] = useState(false);
  /**
   * Is the current pin still exactly where the DEVICE put it?
   *
   * State rather than a ref because the accuracy wording below depends on it and
   * has to re-render when it flips. False the instant the customer taps or drags:
   * their own choice has no margin of error to quote.
   */
  const [pinIsFromGps, setPinIsFromGps] = useState(false);
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null; results: GeocodeResult[] }>({
    busy: false,
    message: null,
    results: [],
  });
  const headingId = useId();
  const accuracy = describeAccuracy(geo.kind === 'located' ? geo.accuracyM : null);

  /** Remove the GPS uncertainty circle. */
  const clearAccuracyCircle = useCallback(() => {
    accuracyRef.current?.remove();
    accuracyRef.current = null;
  }, []);

  /**
   * Move (or create) the marker and tell the parent, rejecting anything outside
   * Belize.
   *
   * `fromGps` is what decides whether the uncertainty circle survives. A GPS fix
   * genuinely is "somewhere in this circle" and should say so. The moment the
   * customer taps or drags, the pin is a deliberate human choice and continuing
   * to draw a margin of error around it would misrepresent it as still automatic.
   */
  const place = useCallback((lat: number, lng: number, opts: { pan?: boolean; zoom?: number; fromGps?: boolean } = {}) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!isWithinBelize(lat, lng)) {
      // Refused rather than stored. The server rejects it too — this only means
      // the customer finds out now instead of on submit.
      setOutOfBounds(true);
      return;
    }
    setOutOfBounds(false);

    if (opts.fromGps) {
      setPinIsFromGps(true);
    } else {
      setPinIsFromGps(false);
      clearAccuracyCircle();
    }

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { draggable: true, keyboard: true, autoPan: true })
        .addTo(map)
        .on('dragend', () => {
          const p = markerRef.current!.getLatLng();
          // A drag is a human decision — drop the uncertainty circle.
          place(p.lat, p.lng);
        });
    }
    if (opts.pan) map.setView([lat, lng], opts.zoom ?? map.getZoom());
    onChangeRef.current({ latitude: lat, longitude: lng });
  }, [clearAccuracyCircle]);

  /** Draw the "your device thinks you're somewhere in here" circle. */
  const drawAccuracyCircle = useCallback((lat: number, lng: number, accuracyM: number) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !Number.isFinite(accuracyM) || accuracyM <= 0) return;
    accuracyRef.current?.remove();
    accuracyRef.current = L.circle([lat, lng], {
      radius: accuracyM,
      color: '#0ea5e9',
      weight: 1,
      fillColor: '#0ea5e9',
      fillOpacity: 0.12,
      interactive: false, // never steals a tap meant for the map
    }).addTo(map);
    // Frame the whole uncertainty, so a vague desktop fix visibly IS vague
    // rather than looking like a confident pin in the wrong place.
    map.fitBounds(accuracyRef.current.getBounds(), { maxZoom: PINNED_ZOOM, padding: [20, 20] });
  }, []);

  // Build the map once, client-side only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      // The default marker icon resolves image URLs relative to the CSS, which
      // breaks under Next's asset hashing. An inline SVG avoids the whole
      // problem and needs no static files.
      const icon = L.divIcon({
        className: '',
        html:
          '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="#0ea5e9" stroke="#ffffff" stroke-width="1.6">' +
          '<path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6" fill="#ffffff" stroke="none"/></svg>',
        iconSize: [34, 34],
        iconAnchor: [17, 32],
      });

      const start = value ?? DEFAULT_CENTRE;
      const map = L.map(containerRef.current, {
        center: [start.latitude, start.longitude],
        zoom: value ? PINNED_ZOOM : DEFAULT_ZOOM,
        // A map that swallows one-finger scroll traps the customer mid-checkout.
        // Dragging still pans; two fingers zoom. Scrolling the PAGE keeps working.
        scrollWheelZoom: false,
        // Keep the customer inside the country they are ordering in.
        maxBounds: L.latLngBounds(
          [BELIZE_BOUNDS.minLatitude, BELIZE_BOUNDS.minLongitude],
          [BELIZE_BOUNDS.maxLatitude, BELIZE_BOUNDS.maxLongitude],
        ),
        maxBoundsViscosity: 0.8,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      // Tapping the map is the manual placement path — no GPS required.
      map.on('click', (e: LeafletNS.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));

      mapRef.current = map;
      L.Marker.prototype.options.icon = icon;
      if (value) place(value.latitude, value.longitude, { pan: true, zoom: PINNED_ZOOM });
      setReady(true);
      // The container is often sized by CSS after mount; without this the tiles
      // render into a stale box and the map looks half-drawn.
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally once: `value` is the seed, and later changes come from the
    // map itself. Re-running would tear the map down mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Follow the chosen district.
   *
   * The map used to open on Belize City and stay there whatever the customer
   * selected, so someone ordering to Punta Gorda was looking at a map 200 km
   * from their address and had to hunt for themselves. District centroids are
   * already in @bmpl/shared, so this is instant and needs no network — which
   * makes it the reliable half of "show me my address": it always works, even
   * when the address lookup below finds nothing.
   *
   * Only moves the VIEW. An existing pin is never touched — the customer placed
   * it deliberately and changing the district must not silently relocate it.
   */
  useEffect(() => {
    const map = mapRef.current;
    const d = asDistrict(district ?? null);
    if (!map || !d || markerRef.current) return;
    const c = DISTRICT_CENTROIDS[d];
    map.setView([c.latitude, c.longitude], DEFAULT_ZOOM);
  }, [district, ready]);

  /**
   * Find the typed address on the map.
   *
   * Best-effort by design. OpenStreetMap's Belize address coverage is patchy, so
   * a miss is normal and is reported as "place the pin yourself" rather than as
   * an error the customer has to fix. A hit drops a PROVISIONAL pin the customer
   * is asked to confirm or drag — the pin stays the authoritative location, and
   * a geocoder's guess never silently becomes the delivery address.
   */
  const findAddress = useCallback(async () => {
    const q = (address ?? '').trim();
    if (q.length < 3) {
      setLookup({ busy: false, message: 'Type your street address above first, then tap this.', results: [] });
      return;
    }
    setLookup({ busy: true, message: null, results: [] });
    try {
      const res = await api.get<{ results: GeocodeResult[] }>(
        `/geocode?q=${encodeURIComponent(q)}${district ? `&district=${encodeURIComponent(district)}` : ''}`,
      );
      if (res.results.length === 0) {
        setLookup({
          busy: false,
          message: 'We couldn’t find that address on the map — many Belize addresses aren’t mapped. Tap the map to place your pin.',
          results: [],
        });
        return;
      }
      const best = res.results[0]!;
      place(best.latitude, best.longitude, { pan: true, zoom: PINNED_ZOOM });
      setLookup({ busy: false, message: null, results: res.results });
    } catch {
      setLookup({
        busy: false,
        message: 'Address lookup isn’t available right now. Tap the map to place your pin instead.',
        results: [],
      });
    }
  }, [address, district, place]);

  /**
   * Put the typed address on the map without being asked.
   *
   * Debounced, and only while the customer has not placed a pin of their own —
   * re-geocoding after somebody has dragged the pin where they want it would
   * throw their answer away and replace it with a guess.
   */
  useEffect(() => {
    if (!autoLocateAddress) return;
    if (value) return;
    const q = (address ?? '').trim();
    if (q.length < 4) return;
    const t = setTimeout(() => void findAddress(), 700);
    return () => clearTimeout(t);
  }, [autoLocateAddress, address, district, value, findAddress]);

  /** GPS. Every failure path ends with the customer still able to continue. */
  const useCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'error', message: 'This device can’t share its location. Tap the map to place the pin instead.' });
      return;
    }
    setGeo({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!isWithinBelize(latitude, longitude)) {
          setGeo({
            kind: 'error',
            message: 'Your device reports a location outside Belize. Tap the map to place the pin instead.',
          });
          return;
        }
        place(latitude, longitude, { pan: true, zoom: PINNED_ZOOM, fromGps: true });
        if (Number.isFinite(accuracy) && accuracy > 0) drawAccuracyCircle(latitude, longitude, accuracy);
        setGeo({ kind: 'located', accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : null });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. You can still tap the map to place the pin.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Your location isn’t available right now. Tap the map to place the pin instead.'
              : 'Finding your location took too long. Tap the map to place the pin instead.';
        setGeo({ kind: 'error', message });
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    );
  }, [drawAccuracyCircle, place]);

  const clear = useCallback(() => {
    markerRef.current?.remove();
    markerRef.current = null;
    clearAccuracyCircle();
    setPinIsFromGps(false);
    setGeo({ kind: 'idle' });
    setOutOfBounds(false);
    onChangeRef.current(null);
  }, [clearAccuracyCircle]);

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-bmpl-md border border-slate-200 p-2.5 sm:p-4">
      <h3 id={headingId} className="bmpl-label">
        {heading ?? 'Delivery location'}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {hint ??
          'Place the pin at the exact spot where you want your order delivered — the map follows the district you choose, and “Show my address” will try to find what you typed. This is optional, but it helps your driver find you.'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          // The primary action here, tapped one-handed. `size="sm"` renders 34px,
          // which is below a comfortable target, so the height is set explicitly.
          className="min-h-[44px] flex-1 sm:flex-none"
          disabled={disabled || geo.kind === 'locating'}
          onClick={useCurrentLocation}
          aria-label="Use my current location to place the delivery pin"
        >
          {geo.kind === 'locating' ? 'Finding you…' : '📍 Use my current location'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] flex-1 sm:flex-none"
          disabled={disabled || lookup.busy}
          onClick={findAddress}
          aria-label="Show the address you typed on the map"
        >
          {lookup.busy ? <Spinner className="h-4 w-4" /> : '🔎 Show my address'}
        </Button>
        {value && (
          <Button type="button" variant="outline" size="sm" className="min-h-[44px]" disabled={disabled} onClick={clear}>
            Remove pin
          </Button>
        )}
      </div>

      {geo.kind === 'error' && (
        <Alert tone="warning" className="mt-3">
          {geo.message}
        </Alert>
      )}
      {lookup.message && (
        <Alert tone="info" className="mt-3">
          {lookup.message}
        </Alert>
      )}
      {lookup.results.length > 0 && (
        <div className="mt-3 rounded-bmpl-md bg-slate-50 p-2.5">
          <p className="text-xs font-semibold text-belize-navy">
            Is this the right place? Drag the pin if it&rsquo;s slightly off.
          </p>
          <p className="mt-0.5 break-words text-xs text-slate-500">{lookup.results[0]!.label}</p>
          {lookup.results.length > 1 && (
            <details className="mt-1.5">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-belize-blue">
                Not right? {lookup.results.length - 1} other match{lookup.results.length > 2 ? 'es' : ''}
              </summary>
              <ul className="mt-1 space-y-1">
                {lookup.results.slice(1).map((r) => (
                  <li key={`${r.latitude},${r.longitude}`}>
                    <button
                      type="button"
                      onClick={() => {
                        place(r.latitude, r.longitude, { pan: true, zoom: PINNED_ZOOM });
                        setLookup((l) => ({ ...l, results: [r, ...l.results.filter((x) => x !== r)] }));
                      }}
                      className="w-full break-words rounded px-2 py-1.5 text-left text-xs text-slate-600 transition hover:bg-white"
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {outOfBounds && (
        <Alert tone="warning" className="mt-3">
          {OUT_OF_BOUNDS_MESSAGE}
        </Alert>
      )}

      {/* h-64 with a hard max-width: the map must never be wider than the page,
          and touch-pan-y lets a one-finger swipe scroll the checkout past it. */}
      {/* -mx on phones: the map claws back the section's own padding so it is as
          wide as the card allows. At 320px that is the difference between a
          usable map and a postage stamp. */}
      <div
        ref={containerRef}
        className="-mx-2.5 mt-3 h-64 overflow-hidden border-y border-slate-200 bg-slate-100 sm:mx-0 sm:rounded-bmpl-md sm:border"
        style={{ touchAction: 'pan-y' }}
        role="application"
        aria-label="Map for choosing your delivery location. Use the current-location button, or tap the map to place the pin."
      />

      {!ready && <p className="mt-2 text-xs text-slate-400">Loading map…</p>}

      {/* The state a screen reader needs, and the reassurance everyone else does.
          Coordinates are deliberately not the headline — they mean nothing to a
          customer — but they are available for anyone who wants them. */}
      <div aria-live="polite" className="mt-2 text-sm">
        {value ? (
          <>
            <p className="font-semibold text-emerald-700">✓ Location selected</p>
            {/* The accuracy line only applies while the pin is still where the
                DEVICE put it. `place` clears the circle on any manual tap or
                drag, so once the customer has corrected it we stop quoting a
                margin of error at them for a point they chose themselves. */}
            {geo.kind === 'located' && pinIsFromGps && (
              <>
                <p className={`mt-0.5 ${accuracy.tone === 'warning' ? 'text-amber-700' : 'text-slate-500'}`}>
                  {accuracy.text}
                </p>
                {accuracy.nudge && <p className="mt-0.5 text-xs text-slate-500">{accuracy.nudge}</p>}
              </>
            )}
          </>
        ) : (
          <p className="text-slate-500">No pin yet — your typed address will be used.</p>
        )}
      </div>
      {value && (
        <details className="mt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-slate-400">Coordinates</summary>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
          </p>
        </details>
      )}
    </section>
  );
}
