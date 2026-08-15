'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
// Leaflet's stylesheet. A static import is what Next expects; it is scoped to
// this component's chunk, which only the checkout route loads.
import 'leaflet/dist/leaflet.css';
import { BELIZE_BOUNDS, OUT_OF_BOUNDS_MESSAGE, isWithinBelize, type Coordinates } from '@bmpl/shared';
import { Alert, Button } from '../ui';

/** Belize City — where the map opens before the customer has done anything. */
const DEFAULT_CENTRE: Coordinates = { latitude: 17.4995, longitude: -88.1976 };
const DEFAULT_ZOOM = 13;
const PINNED_ZOOM = 17;

/** How long to wait for a GPS fix before telling the customer it isn't coming. */
const GEO_TIMEOUT_MS = 12_000;
/** Above this many metres a fix is too vague to be a doorstep; say so. */
const LOW_ACCURACY_M = 100;

type GeoState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'error'; message: string }
  | { kind: 'located'; accuracyM: number | null };

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
 * nor its CSS reaches any other page's bundle — checkout is the only route that
 * pays for it.
 *
 * The pin is OPTIONAL. A customer who refuses location permission, or whose GPS
 * fails, or who simply doesn't want to, completes checkout on the typed address
 * exactly as before. Nothing here is allowed to become a wall.
 */
export function LocationPicker({
  value,
  onChange,
  disabled,
}: {
  value: Coordinates | null;
  onChange: (next: Coordinates | null) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  // Read inside the map callbacks without re-running the setup effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [ready, setReady] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [outOfBounds, setOutOfBounds] = useState(false);
  const headingId = useId();

  /** Move (or create) the marker and tell the parent, rejecting anything outside Belize. */
  const place = useCallback((lat: number, lng: number, opts: { pan?: boolean; zoom?: number } = {}) => {
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

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { draggable: true, keyboard: true, autoPan: true })
        .addTo(map)
        .on('dragend', () => {
          const p = markerRef.current!.getLatLng();
          place(p.lat, p.lng);
        });
    }
    if (opts.pan) map.setView([lat, lng], opts.zoom ?? map.getZoom());
    onChangeRef.current({ latitude: lat, longitude: lng });
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
        place(latitude, longitude, { pan: true, zoom: PINNED_ZOOM });
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
  }, [place]);

  const clear = useCallback(() => {
    markerRef.current?.remove();
    markerRef.current = null;
    setGeo({ kind: 'idle' });
    setOutOfBounds(false);
    onChangeRef.current(null);
  }, []);

  return (
    <section aria-labelledby={headingId} className="rounded-bmpl-md border border-slate-200 p-3 sm:p-4">
      <h3 id={headingId} className="bmpl-label">
        Delivery location
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Place the pin at the exact spot where you want your order delivered. This is optional, but it helps your driver
        find you.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || geo.kind === 'locating'}
          onClick={useCurrentLocation}
          aria-label="Use my current location to place the delivery pin"
        >
          {geo.kind === 'locating' ? 'Finding you…' : '📍 Use my current location'}
        </Button>
        {value && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={clear}>
            Remove pin
          </Button>
        )}
      </div>

      {geo.kind === 'error' && (
        <Alert tone="warning" className="mt-3">
          {geo.message}
        </Alert>
      )}
      {outOfBounds && (
        <Alert tone="warning" className="mt-3">
          {OUT_OF_BOUNDS_MESSAGE}
        </Alert>
      )}

      {/* h-64 with a hard max-width: the map must never be wider than the page,
          and touch-pan-y lets a one-finger swipe scroll the checkout past it. */}
      <div
        ref={containerRef}
        className="mt-3 h-64 w-full max-w-full overflow-hidden rounded-bmpl-md border border-slate-200 bg-slate-100"
        style={{ touchAction: 'pan-y' }}
        role="application"
        aria-label="Map for choosing your delivery location. Use the current-location button, or tap the map to place the pin."
      />

      {!ready && <p className="mt-2 text-xs text-slate-400">Loading map…</p>}

      {/* The state a screen reader needs, and the reassurance everyone else does.
          Coordinates are deliberately not the headline — they mean nothing to a
          customer — but they are available for anyone who wants them. */}
      <p aria-live="polite" className="mt-2 text-sm">
        {value ? (
          <span className="font-semibold text-emerald-700">
            ✓ Delivery location selected
            {geo.kind === 'located' && geo.accuracyM != null && (
              <span className="font-normal text-slate-500">
                {geo.accuracyM > LOW_ACCURACY_M
                  ? ` — accurate to about ${geo.accuracyM} m, so please check the pin`
                  : ` — accurate to about ${geo.accuracyM} m`}
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-500">No pin yet — your typed address will be used.</span>
        )}
      </p>
      {value && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-400">Coordinates</summary>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
          </p>
        </details>
      )}
    </section>
  );
}
