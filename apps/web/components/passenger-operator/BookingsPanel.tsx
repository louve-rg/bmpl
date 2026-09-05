'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Spinner, StatusBadge } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { bookingActions, type OperatorBooking } from '../../lib/passenger-operator';
import { ApprovalRequired } from './data';

/**
 * Riders' bookings on the operator's departures. Confirm and cancel mirror
 * the server's rules (only a request confirms; a request or a confirmation
 * cancels) and every refusal is shown verbatim — the fare gate and the
 * seats-held-at-confirmation rule both live server-side, and their messages
 * ("pricing unavailable", "assign a vehicle first") are the explanation.
 * Nothing here shows an amount: no fare is quoted or charged anywhere yet.
 */
export function BookingsPanel() {
  const [rows, setRows] = useState<OperatorBooking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.get<OperatorBooking[]>('/passenger/provider/bookings'));
      setNotApproved(false);
      setErr(null);
    } catch (e) {
      if ((e as ApiError).status === 403) setNotApproved(true);
      else setErr(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (notApproved) return <ApprovalRequired />;

  return (
    <div className="space-y-4">
      {err && <Alert tone="error">{err}</Alert>}
      {rows && rows.length === 0 ? (
        <EmptyState title="No bookings yet" description="Riders' seat requests on your departures appear here for you to answer." />
      ) : (
        <ul className="space-y-3">{rows?.map((b) => <BookingRow key={b.id} booking={b} onChanged={reload} />)}</ul>
      )}
    </div>
  );
}

function BookingRow({ booking: b, onChanged }: { booking: OperatorBooking; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const actions = bookingActions(b.status);
  const journey = b.from && b.to ? `${b.from} → ${b.to}` : null;

  async function act(path: 'confirm' | 'cancel', body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/passenger/provider/bookings/${b.id}/${path}`, body);
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
              <b className="text-sm text-belize-navy">{b.passengerName ?? 'Rider'}</b>
              <StatusBadge status={b.status} />
              <Badge tone="neutral">{b.reference}</Badge>
              <Badge tone="neutral">
                {b.seats} seat{b.seats === 1 ? '' : 's'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {b.routeName ?? 'Departure'}
              {journey && <> · {journey}</>}
              {b.tripReference && <> · {b.tripReference}</>}
            </p>
            {b.scheduledDepartureAt && (
              <p className="mt-1 text-sm text-slate-500">Departs {new Date(b.scheduledDepartureAt).toLocaleString()}</p>
            )}
            {b.cancellationReason && <p className="mt-1 text-xs text-slate-500">Cancelled: {b.cancellationReason}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions.includes('confirm') && (
              <Button type="button" size="sm" disabled={busy} onClick={() => act('confirm', {})}>
                Confirm
              </Button>
            )}
            {actions.includes('cancel') && !cancelOpen && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
                Cancel booking
              </Button>
            )}
          </div>
        </div>

        {cancelOpen && (
          <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
            <Field label="Reason" htmlFor={`${b.id}-reason`} hint="Optional — the rider sees this.">
              <Input id={`${b.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => act('cancel', { reason: reason.trim() || undefined })}
              >
                Cancel this booking
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
