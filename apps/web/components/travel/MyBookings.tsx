'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { riderAccessView, riderBookingView, type RiderBooking } from '../../lib/passenger-travel';

/**
 * The rider's own bookings. Each row's words come from riderBookingView,
 * which keeps the held-at-confirmation rule: REQUESTED says plainly that no
 * seat is held. Cancel covers both a confirmed seat and an unanswered
 * request (the server lets a rider always withdraw an unanswered ask);
 * refusals are shown verbatim. No fares, fees or refund language — the API
 * moves no money and the copy must not imply that it does.
 */
export function MyBookings() {
  const [rows, setRows] = useState<RiderBooking[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.get<RiderBooking[]>('/passenger/bookings'));
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (err) {
    // A restricted account is told calmly, in the server's words — see
    // riderAccessView. A malfunction still looks like one.
    const view = riderAccessView(err.status, errMessage(err));
    return view.kind === 'restricted' ? (
      <EmptyState title={view.title} description={view.detail} />
    ) : (
      <Alert tone="error">{view.detail}</Alert>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No bookings yet"
        description="Request seats on a departure and it appears here, with the operator's answer."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((b) => (
        <BookingRow key={b.id} booking={b} onChanged={reload} />
      ))}
    </ul>
  );
}

function BookingRow({ booking: b, onChanged }: { booking: RiderBooking; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const view = riderBookingView(b.status);
  const journey = b.from && b.to ? `${b.from} → ${b.to}` : null;

  async function cancel() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/passenger/bookings/${b.id}/cancel`, { reason: reason.trim() || undefined });
      setCancelOpen(false);
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <UiCard className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm text-belize-navy">{b.routeName ?? 'Departure'}</b>
              <Badge tone={view.tone}>{view.label}</Badge>
              <Badge tone="neutral">{b.reference}</Badge>
              <Badge tone="neutral">
                {b.seats} seat{b.seats === 1 ? '' : 's'}
              </Badge>
            </div>
            {journey && <p className="mt-1 text-sm text-slate-600">{journey}</p>}
            {b.scheduledDepartureAt && (
              <p className="mt-1 text-sm text-slate-500">Departs {new Date(b.scheduledDepartureAt).toLocaleString()}</p>
            )}
            {view.detail && <p className="mt-1 text-xs text-slate-600">{view.detail}</p>}
            {b.cancellationReason && <p className="mt-1 text-xs text-slate-500">Cancelled: {b.cancellationReason}</p>}
          </div>
          {view.cancellable && !cancelOpen && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
              {b.status === 'REQUESTED' ? 'Withdraw request' : 'Cancel booking'}
            </Button>
          )}
        </div>

        {cancelOpen && (
          <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
            <Field label="Reason" htmlFor={`${b.id}-reason`} hint="Optional — the operator sees this.">
              <Input id={`${b.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={cancel}>
                {b.status === 'REQUESTED' ? 'Withdraw it' : 'Cancel this booking'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCancelOpen(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
        {err && (
          <Alert tone="error" className="mt-3">
            {err}
          </Alert>
        )}
      </UiCard>
    </li>
  );
}
