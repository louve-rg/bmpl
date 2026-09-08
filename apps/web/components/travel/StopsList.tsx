import { stopLabel, type RouteStop } from '../../lib/passenger-travel';

/**
 * A route's ordered stops, IN THE OPERATOR'S ORDER AS RETURNED. The array
 * arrives sorted by the operator's own sequence and each stop's number is
 * that stored `sequence` rendered verbatim — nothing here sorts, renumbers
 * or re-derives the order. The sequence is authority.
 *
 * Coordinates are returned but deliberately not rendered: the app has no map
 * view of a route, and printing raw latitude/longitude serves nobody. A stop
 * is shown by its operator-given name (or its town) plus its district.
 */
export function StopsList({ stops }: { stops: RouteStop[] }) {
  if (stops.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        The operator hasn&rsquo;t listed intermediate stops for this route.
      </p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {stops.map((s) => (
        <li key={`${s.sequence}-${s.city}-${s.name ?? ''}`} className="flex items-baseline gap-2 text-sm">
          <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400">{s.sequence}.</span>
          <span className="min-w-0">
            <span className="font-medium text-belize-navy">{stopLabel(s)}</span>
            <span className="text-slate-500">
              {s.name?.trim() ? ` · ${s.city}` : ''} · {s.district}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
