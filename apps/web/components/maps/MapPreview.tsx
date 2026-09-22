'use client';

import { useEffect, useRef } from 'react';
import { BELIZE_BOUNDS } from '@bmpl/shared';
import type { MapPoint } from '../../lib/trip-map';
import 'leaflet/dist/leaflet.css';

/**
 * A read-only, zoomable map of the points it is given — nothing more.
 *
 * Same stack as LocationPicker (Leaflet, dynamically imported, OpenStreetMap
 * tiles), but this one never places, moves or geocodes anything: the caller
 * passes coordinates the API sent, and markers are all it draws. Deliberately
 * no line between the markers — no routing engine exists here, and a drawn
 * line would claim a road or a crossing this app knows nothing about.
 */
export function MapPreview({ points, className = '' }: { points: MapPoint[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (points.length === 0) return;
    let cancelled = false;
    // Held locally so cleanup tears down exactly the map this effect built.
    let map: import('leaflet').Map | null = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      // Inline SVG icon — the default icon's image URLs break under Next's
      // asset hashing (same reasoning as LocationPicker).
      const icon = L.divIcon({
        className: '',
        html:
          '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="#0ea5e9" stroke="#ffffff" stroke-width="1.6">' +
          '<path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6" fill="#ffffff" stroke="none"/></svg>',
        iconSize: [34, 34],
        iconAnchor: [17, 32],
      });

      map = L.map(containerRef.current, {
        // One-finger scroll must keep scrolling the PAGE; dragging pans,
        // pinch zooms — the same phone-first rule LocationPicker follows.
        scrollWheelZoom: false,
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

      for (const p of points) {
        L.marker([p.latitude, p.longitude], { icon }).addTo(map).bindPopup(p.label);
      }
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
      setTimeout(() => map?.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
    // Points come from one fetch of one job; a changed job remounts the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (points.length === 0) return null;
  return <div ref={containerRef} className={`h-64 w-full overflow-hidden rounded-bmpl-lg border border-slate-200 ${className}`} />;
}
