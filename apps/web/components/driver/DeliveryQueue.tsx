'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatDistanceKm, formatMinutes, type DriverNextAction, type GeoPrecision } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Badge, Button, Card, Spinner, StatusBadge } from '../ui';
import { errMessage } from './dashboard-data';

/* ----------------------------------------------------------------- types */

export interface QueueItem {
  id: string;
  status: string;
  statusLabel: string;
  view: 'available' | 'assigned' | 'active' | 'completed' | null;
  orderNumber: string;
  vendor: string;
  pickupArea: string | null;
  itemCount: number;
  city: string | null;
  district: string | null;
  feeMinor: number;
  position: number;
  recommendedPosition: number | null;
  stopKind: 'PICKUP' | 'DROPOFF';
  stopArea: string | null;
  legDistanceKm: number | null;
  legMinutes: number | null;
  estimatePrecision: GeoPrecision;
  nextAction: DriverNextAction;
  canReorder: boolean;
  reorderBlockedReason: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  route: {
    totalDistanceKm: number | null;
    totalMinutes: number | null;
    precision: GeoPrecision;
    disclosure: string;
    recommendedOrder: string[];
  };
  followsRecommendation: boolean;
}

/* ------------------------------------------------------------- component */

/**
 * The driver's delivery queue: what to do, in what order, and roughly how far
 * apart the stops are.
 *
 * Two orderings are on screen at once — the driver's, and the recommendation.
 * The platform does not silently reorder anyone's work: the suggestion is
 * offered as a single "Use recommended order" action and is otherwise just a
 * number beside each row.
 *
 * Reordering is available by DRAG (the grip handle) and by MOVE UP/DOWN buttons.
 * Both exist deliberately: a drag-only queue is unusable with a keyboard or a
 * screen reader, and this is a screen drivers use one-handed in a vehicle.
 *
 * What reordering does NOT do is worth stating: it writes one column
 * (`driverQueuePosition`) and cannot reassign a job, change its status, skip a
 * pickup, or alter what anyone is paid. Jobs the lifecycle pins in place — an
 * unaccepted offer, a delivery being handed over — render with their handle
 * disabled and the reason shown.
 */
export function DeliveryQueue({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get<QueueResponse>('/driver/jobs/queue'));
      setError(null);
    } catch {
      // Silent on READ. This panel sits above the tabbed lists, which fetch the
      // same jobs and report the same failure; two error banners for one outage
      // is noise. Reorder failures below are surfaced — those are actions the
      // driver took and needs an answer to.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Persist an order. The server is the arbiter — it re-validates every id. */
  const save = useCallback(
    async (ids: string[], message: string) => {
      setBusy(true);
      setError(null);
      try {
        setData(await api.put<QueueResponse>('/driver/jobs/queue', { deliveryIds: ids }));
        setAnnouncement(message);
        onChanged?.();
      } catch (e) {
        setError(errMessage(e));
        // Re-read rather than keeping an order the server rejected on screen.
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading your queue…
      </div>
    );
  }
  // One job is not a queue. The route panel only earns its space from two.
  if (!data || data.items.length < 2) return null;

  const reorderable = data.items.filter((i) => i.canReorder);

  const move = (index: number, delta: number) => {
    const ordered = [...reorderable];
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item!);
    void save(
      ordered.map((i) => i.id),
      `Moved order ${item!.orderNumber} to position ${target + 1} of ${ordered.length}.`,
    );
  };

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ordered = [...reorderable];
    const from = ordered.findIndex((i) => i.id === dragId);
    const to = ordered.findIndex((i) => i.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item!);
    setDragId(null);
    void save(
      ordered.map((i) => i.id),
      `Moved order ${item!.orderNumber} to position ${to + 1} of ${ordered.length}.`,
    );
  };

  const useRecommended = () => {
    const order = data.route.recommendedOrder.filter((id) => reorderable.some((i) => i.id === id));
    void save(order, 'Queue set to the recommended route order.');
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="bmpl-eyebrow">Your delivery queue</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {data.items.length} deliver{data.items.length === 1 ? 'y' : 'ies'} in progress
            {data.route.totalDistanceKm != null && (
              <>
                {' · '}
                <span className="tabular-nums">{formatDistanceKm(data.route.totalDistanceKm)}</span>
                {data.route.totalMinutes != null && <> · about {formatMinutes(data.route.totalMinutes)}</>}
              </>
            )}
          </p>
        </div>
        {!data.followsRecommendation && data.route.recommendedOrder.length > 1 && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={useRecommended}>
            Use recommended order
          </Button>
        )}
      </div>

      {/* Never presented as a live ETA — there is no traffic data behind it. */}
      <p className="mt-2 text-[11px] text-slate-400">{data.route.disclosure}</p>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {/* Reorder outcomes are announced for screen-reader users, who get no
          visual confirmation from the list rearranging itself. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <ol className="mt-3 space-y-2">
        {data.items.map((item) => {
          const reorderIndex = reorderable.findIndex((i) => i.id === item.id);
          return (
            <li
              key={item.id}
              draggable={item.canReorder && !busy}
              onDragStart={() => setDragId(item.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (item.canReorder) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (item.canReorder) dropOn(item.id);
              }}
              className={`rounded-bmpl-md border p-3 transition ${
                dragId === item.id ? 'border-belize-blue bg-belize-blue/5 opacity-60' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <QueueHandle
                  item={item}
                  index={reorderIndex}
                  total={reorderable.length}
                  busy={busy}
                  onMove={move}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/dashboard/driver/jobs/${item.id}`}
                      className="truncate text-sm font-bold text-belize-navy hover:underline"
                    >
                      Order #{item.orderNumber}
                    </Link>
                    <StatusBadge status={item.status} />
                    {item.recommendedPosition != null && item.recommendedPosition !== item.position && (
                      <Badge tone="brand">Suggested #{item.recommendedPosition}</Badge>
                    )}
                  </div>

                  {/* The single most useful line: where they are going next. */}
                  <p className="mt-1 break-words text-sm text-slate-600">
                    <span className="font-medium">{item.stopKind === 'PICKUP' ? 'Collect from' : 'Deliver to'}:</span>{' '}
                    {item.stopKind === 'PICKUP' ? item.vendor : (item.stopArea ?? 'Destination unavailable')}
                    {item.stopKind === 'PICKUP' && item.stopArea ? ` · ${item.stopArea}` : ''}
                  </p>

                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span>{item.nextAction.label}</span>
                    {item.legDistanceKm != null && (
                      <span className="tabular-nums">
                        · {formatDistanceKm(item.legDistanceKm)}
                        {item.legMinutes != null && ` · ~${formatMinutes(item.legMinutes)}`}
                        {item.estimatePrecision === 'DISTRICT' && ' (rough)'}
                      </span>
                    )}
                  </p>

                  {item.reorderBlockedReason && (
                    <p className="mt-1 text-[11px] text-slate-400">{item.reorderBlockedReason}</p>
                  )}
                </div>

                <Link
                  href={`/dashboard/driver/jobs/${item.id}`}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-bmpl-md px-2 text-sm font-semibold text-belize-blue transition hover:bg-belize-blue/5"
                >
                  Open
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/**
 * The reorder control: a grip that can be dragged, plus explicit up/down
 * buttons. The buttons are the primary mechanism for anyone not using a mouse,
 * so they are real focusable controls with labels — not a keyboard afterthought
 * bolted to a drag target.
 */
function QueueHandle({
  item,
  index,
  total,
  busy,
  onMove,
}: {
  item: QueueItem;
  index: number;
  total: number;
  busy: boolean;
  onMove: (index: number, delta: number) => void;
}) {
  if (!item.canReorder) {
    return (
      <span
        className="flex h-11 w-6 shrink-0 items-center justify-center text-xs font-bold text-slate-300"
        title={item.reorderBlockedReason ?? undefined}
        aria-hidden
      >
        {item.position}
      </span>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-center">
      <button
        type="button"
        disabled={busy || index <= 0}
        onClick={() => onMove(index, -1)}
        aria-label={`Move order ${item.orderNumber} earlier in your queue`}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-belize-navy disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      {/* Grip: the drag affordance, and the position indicator. cursor-grab and
          touch-none keep a drag from also scrolling the page on a phone. */}
      <span
        className="flex cursor-grab touch-none flex-col items-center gap-0.5 py-0.5 text-slate-300 active:cursor-grabbing"
        title="Drag to reorder"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
        <span className="text-[11px] font-bold tabular-nums text-slate-500">{item.position}</span>
      </span>

      <button
        type="button"
        disabled={busy || index < 0 || index >= total - 1}
        onClick={() => onMove(index, 1)}
        aria-label={`Move order ${item.orderNumber} later in your queue`}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-belize-navy disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
