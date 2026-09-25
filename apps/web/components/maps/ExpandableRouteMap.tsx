'use client';

import { useState } from 'react';
import { labelStops, type MapPoint } from '../../lib/trip-map';
import { MapPreview } from './MapPreview';
import { FullScreenMapModal } from './FullScreenMapModal';

/**
 * The reusable BMPL-182 pattern: behind a tap (so tiles never load uninvited
 * on a phone connection — the BMPL-136 rule), an embedded map preview with an
 * expand control that opens the same points full-screen, plus the A/B/C/D
 * stop legend both views share.
 *
 * This is a composition, not a new map implementation — it draws exactly the
 * points it is given via `MapPreview` (BMPL-136: no route line, no
 * geocoding, no invented geometry) inside `FullScreenMapModal` (the generic
 * full-screen shell). A caller with only known stops and no routing provider
 * gets exactly those stops, ordered and lettered, and nothing drawn between
 * them — the same honest "ordered known stops" fallback the shipment planner
 * itself uses (root CLAUDE.md §5).
 *
 * Selecting a stop — tapping its legend row, or tapping its marker — pans and
 * opens that stop's popup in whichever view is open; it never rebuilds the
 * map underneath a reader.
 */
export function ExpandableRouteMap({
  points,
  title = 'Route',
  emptyHint,
  className = '',
  /** Tiles load only after a tap, by default — set false when the caller already gated the reveal. */
  lazy = true,
}: {
  points: MapPoint[];
  /** Full-screen modal header, e.g. "SPX1234 · route". */
  title?: string;
  /** Shown instead of the map when there is nothing to draw — never a blank box. */
  emptyHint?: string;
  className?: string;
  lazy?: boolean;
}) {
  const [revealed, setRevealed] = useState(!lazy);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const stops = labelStops(points);

  if (stops.length === 0) {
    return emptyHint ? <p className="text-sm text-slate-500">{emptyHint}</p> : null;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">On the map</p>
        <div className="flex gap-2">
          {revealed && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-bmpl-md border border-slate-300 px-4 text-sm font-semibold text-belize-navy"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path
                  d="M9 4H5a1 1 0 0 0-1 1v4m16 0V5a1 1 0 0 0-1-1h-4m0 16h4a1 1 0 0 0 1-1v-4M4 15v4a1 1 0 0 0 1 1h4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Expand
            </button>
          )}
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-bmpl-md border border-slate-300 px-4 text-sm font-semibold text-belize-navy"
          >
            {revealed ? 'Hide map' : 'Show map'}
          </button>
        </div>
      </div>

      {revealed && (
        <>
          <MapPreview points={stops} className="mt-2" selectedIndex={selected} onSelectIndex={setSelected} />
          <RouteLegend stops={stops} selected={selected} onSelect={setSelected} />
        </>
      )}

      <FullScreenMapModal open={expanded} onClose={() => setExpanded(false)} title={title}>
        <div className="flex h-full flex-col">
          <MapPreview
            points={stops}
            heightClassName="flex-1 min-h-0"
            bordered={false}
            scrollWheelZoom
            selectedIndex={selected}
            onSelectIndex={setSelected}
          />
          <div className="max-h-[35vh] shrink-0 overflow-y-auto border-t border-slate-200 p-3">
            <RouteLegend stops={stops} selected={selected} onSelect={setSelected} />
          </div>
        </div>
      </FullScreenMapModal>
    </div>
  );
}

function RouteLegend({
  stops,
  selected,
  onSelect,
}: {
  stops: ReturnType<typeof labelStops>;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <ul className="mt-2 space-y-1">
      {stops.map((s, i) => (
        <li key={`${s.letter}-${s.latitude}-${s.longitude}`}>
          <button
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={selected === i}
            className={`flex min-h-[40px] w-full items-center gap-2 rounded-bmpl-md px-2 text-left text-xs transition ${
              selected === i ? 'bg-belize-blue/10 text-belize-navy' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-belize-blue text-[11px] font-bold text-white"
              aria-hidden
            >
              {s.letter}
            </span>
            <span className="truncate">{s.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
