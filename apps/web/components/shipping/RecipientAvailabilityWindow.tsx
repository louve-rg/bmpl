'use client';

import { useEffect, useState } from 'react';
import { shippingApi, type RecipientAvailabilityWindows } from '../../lib/shipping';
import { Alert, Button, Spinner } from '../ui';
import type { ApiError } from '../../lib/api';

interface Row {
  startTime: string;
  endTime: string;
}

const MAX_ROWS = 5;

function formatClock(hhmm: string): string {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Overnight (22:00-02:00) is a legitimate, deliberately-supported shape —
 *  the same convention the sender's own AvailabilityWindows uses. */
function formatWindow(w: Row): string {
  const overnight = w.endTime < w.startTime;
  return `${formatClock(w.startTime)}–${formatClock(w.endTime)}${overnight ? ' (overnight)' : ''}`;
}

/**
 * Edward requirement 11: a linked recipient's own delivery availability
 * window — the RECIPIENT-role counterpart to the sender's own
 * `<AvailabilityWindows>`, but deliberately a separate, smaller component
 * rather than a shared one. It never sees or touches the sender's window
 * (the API scopes the write to RECIPIENT rows only, and the read endpoint
 * never returns the sender's), and it has no way to know client-side
 * whether the governing leg has already started — RecipientTrackingView
 * carries no raw leg status, only a completed/isCurrent pair, which is not
 * enough to distinguish PENDING/READY from IN_PROGRESS. So this relies on
 * the server's own gating (BMPL-284) and simply surfaces the refusal
 * message inline rather than pre-computing a locked state — graceful
 * degradation, not a missing feature.
 */
export function RecipientAvailabilityWindow({ reference }: { reference: string }) {
  const [stored, setStored] = useState<Row[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .incomingAvailabilityWindow(reference)
      .then((v: RecipientAvailabilityWindows) => {
        if (cancelled) return;
        setStored(v.windows);
        setRows(v.windows);
      })
      .catch(() => {
        if (!cancelled) setStored([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (stored === null) return null;

  async function save() {
    const incomplete = rows.find((r) => !r.startTime || !r.endTime);
    if (incomplete) {
      setErr('Fill in both times for each window, or remove it.');
      return;
    }
    const zeroDuration = rows.find((r) => r.startTime === r.endTime);
    if (zeroDuration) {
      setErr('A window needs a start time different from its end time.');
      return;
    }
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const result = await shippingApi.setIncomingAvailabilityWindow(reference, rows);
      setStored(result.windows);
      setRows(result.windows);
      setSaved(true);
    } catch (e) {
      setErr((e as ApiError).message ?? 'We could not save this.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Your delivery availability</h2>
      <p className="mt-1 text-sm text-slate-600">
        Set the hours you&rsquo;ll be there to receive this parcel. Leave this blank and the driver will attempt delivery at
        any time.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              aria-label="Start time"
              value={r.startTime}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
              className="bmpl-input min-h-[44px] w-auto px-2 py-1"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              aria-label="End time"
              value={r.endTime}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
              className="bmpl-input min-h-[44px] w-auto px-2 py-1"
            />
            <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {rows.length === 0 && stored.length > 0 && (
        <p className="mt-1 text-sm text-slate-500">
          Currently: {stored.map(formatWindow).join(', ')} — save with no rows to clear this.
        </p>
      )}
      {rows.length < MAX_ROWS && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setRows([...rows, { startTime: '', endTime: '' }])}>
          + Add a window
        </Button>
      )}

      {err && (
        <Alert tone="warning" className="mt-3">
          {err}
        </Alert>
      )}
      {saved && !err && (
        <Alert tone="success" className="mt-3">
          Saved.
        </Alert>
      )}

      <Button className="mt-4 min-h-[44px] w-full sm:w-auto" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save availability'}
      </Button>
    </div>
  );
}
