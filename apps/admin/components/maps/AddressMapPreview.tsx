'use client';

import { useState } from 'react';
import { labelStops, type MapPoint } from '../../lib/trip-map';
import { MapPreview } from './MapPreview';
import { FullScreenMapModal } from './FullScreenMapModal';

/**
 * MDF-538: admin's own read-only map preview, behind a tap so tiles never
 * load uninvited (BMPL-136), with an expand control for a closer look.
 *
 * This is admin's equivalent of apps/web's ExpandableRouteMap -- same shape
 * (tap-to-reveal, Expand into FullScreenMapModal, a lettered legend when
 * there's more than one stop), built from the same primitives, but it is a
 * NEW composite, not a port of ExpandableRouteMap itself. Composites that
 * know about a specific audience's needs (LocationPicker, AddressField,
 * ExpandableRouteMap) stay in their own app; only the framework-agnostic
 * primitives underneath them (MapPreview, FullScreenMapModal,
 * cooperative-map-drag, MapPoint/labelStops) are shared by being ported into
 * each app that needs them -- see FullScreenMapModal.tsx's own header
 * comment for why that's a port rather than a packages/ui extraction.
 *
 * Always lazy (no `lazy` prop to turn off): every admin surface this is used
 * on is read-only and the tiles-on-tap rule applies unconditionally here,
 * unlike ExpandableRouteMap's web callers which sometimes already gated the
 * reveal themselves.
 */
export function AddressMapPreview({
  points,
  title = 'Map',
  emptyHint,
  className = '',
}: {
  points: MapPoint[];
  /** Full-screen modal header, e.g. "SPX1234 · route". */
  title?: string;
  /** Shown instead of the map when there is nothing to draw — never a blank box. */
  emptyHint?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-bmpl-md border border-[color:var(--bmpl-border)] px-4 text-sm font-semibold text-[color:var(--bmpl-text)]"
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
            className="inline-flex min-h-[44px] items-center rounded-bmpl-md border border-[color:var(--bmpl-border)] px-4 text-sm font-semibold text-[color:var(--bmpl-text)]"
          >
            {revealed ? 'Hide map' : 'Show map'}
          </button>
        </div>
      </div>

      {revealed && !expanded && (
        <>
          <MapPreview points={stops} className="mt-2" selectedIndex={selected} onSelectIndex={setSelected} />
          {stops.length > 1 && <StopLegend stops={stops} selected={selected} onSelect={setSelected} />}
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
          {stops.length > 1 && (
            <div className="max-h-[35vh] shrink-0 overflow-y-auto border-t border-slate-200 p-3">
              <StopLegend stops={stops} selected={selected} onSelect={setSelected} />
            </div>
          )}
        </div>
      </FullScreenMapModal>
    </div>
  );
}

function StopLegend({
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
              selected === i ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:bg-slate-50'
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
