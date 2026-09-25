'use client';

import { useEffect, useRef } from 'react';
import { BELIZE_BOUNDS } from '@bmpl/shared';
import type { MapPoint } from '../../lib/trip-map';
import 'leaflet/dist/leaflet.css';

/** A point the map draws, optionally carrying its route-stop letter (BMPL-182: A, B, C…). */
export type MapPreviewPoint = MapPoint & { letter?: string };

/** A letter badge if the stop has one, else the plain BMPL-136 pin. */
function markerIcon(L: typeof import('leaflet'), letter: string | undefined) {
  if (letter) {
    return L.divIcon({
      className: '',
      html:
        `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;` +
        `background:#0ea5e9;color:#ffffff;font:700 13px system-ui,sans-serif;border:2px solid #ffffff;` +
        `box-shadow:0 1px 3px rgba(0,0,0,0.35);">${letter}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }
  return L.divIcon({
    className: '',
    html:
      '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="#0ea5e9" stroke="#ffffff" stroke-width="1.6">' +
      '<path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6" fill="#ffffff" stroke="none"/></svg>',
    iconSize: [34, 34],
    iconAnchor: [17, 32],
  });
}

/**
 * A read-only, zoomable map of the points it is given — nothing more.
 *
 * Same stack as LocationPicker (Leaflet, dynamically imported, OpenStreetMap
 * tiles), but this one never places, moves or geocodes anything: the caller
 * passes coordinates the API sent, and markers are all it draws. Deliberately
 * no line between the markers — no routing engine exists here, and a drawn
 * line would claim a road or a crossing this app knows nothing about.
 *
 * BMPL-182 additions, both opt-in and backward compatible with the BMPL-136
 * caller: a point may carry a `letter` (A, B, C…) drawn inside its marker
 * instead of the plain pin, `onSelectIndex`/`selectedIndex` let a caller (the
 * stop legend in ExpandableRouteMap) drive which marker is focused without
 * tearing the map down, and `scrollWheelZoom` lets a full-screen host enable
 * wheel-zoom where trapping page scroll is no longer a concern.
 */
export function MapPreview({
  points,
  className = '',
  heightClassName = 'h-64',
  scrollWheelZoom = false,
  selectedIndex = null,
  onSelectIndex,
  bordered = true,
}: {
  points: MapPreviewPoint[];
  className?: string;
  heightClassName?: string;
  scrollWheelZoom?: boolean;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number) => void;
  /** Off for a full-screen host, which already frames the map with its own edges. */
  bordered?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<import('leaflet').Marker[]>([]);
  // Read inside Leaflet's own event callbacks without re-running the build effect.
  const onSelectRef = useRef(onSelectIndex);
  onSelectRef.current = onSelectIndex;

  // The effect is keyed on the points' CONTENT, not the array identity: a
  // caller that computes `points` inline re-creates the array every render,
  // and rebuilding the map each time would flicker it away under the reader.
  // But a caller whose points genuinely change (or resolve late, after
  // mount) must get a rebuilt map, not a silently blank one.
  const pointsKey = points.map((p) => `${p.latitude},${p.longitude},${p.label},${p.letter ?? ''}`).join('|');

  useEffect(() => {
    if (points.length === 0) return;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        // One-finger scroll must keep scrolling the PAGE when embedded; a
        // full-screen host has no page underneath to protect and opts in.
        scrollWheelZoom,
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

      const markers = points.map((p, i) => {
        const marker = L.marker([p.latitude, p.longitude], { icon: markerIcon(L, p.letter) })
          .addTo(map)
          .bindPopup(p.label);
        marker.on('click', () => onSelectRef.current?.(i));
        return marker;
      });

      if (points.length === 1) {
        const only = points[0]!;
        map.setView([only.latitude, only.longitude], 15);
      } else {
        map.fitBounds(
          L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])),
          { padding: [30, 30], maxZoom: 15 },
        );
      }
      // The container is sized by CSS after mount; without this the tiles
      // render into a stale box and the map looks half-drawn.
      setTimeout(() => map.invalidateSize(), 0);

      mapRef.current = map;
      markersRef.current = markers;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = [];
    };
    // `points` is read inside but represented by pointsKey — same content,
    // stable identity (see above). `scrollWheelZoom` is set once at build
    // time by design — a host does not flip it mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey]);

  // Selection is driven by the legend (or a marker tap, via onSelectIndex)
  // and only pans/opens a popup — it never rebuilds the map underneath a
  // reader who is mid-gesture.
  useEffect(() => {
    if (selectedIndex == null) return;
    const map = mapRef.current;
    const marker = markersRef.current[selectedIndex];
    const point = points[selectedIndex];
    if (!map || !marker || !point) return;
    map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 15));
    marker.openPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  if (points.length === 0) return null;
  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden ${bordered ? 'rounded-bmpl-lg border border-slate-200' : ''} ${heightClassName} ${className}`}
    />
  );
}
