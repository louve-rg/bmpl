'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Spinner, StatusBadge } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { tripAction, type PassengerTrip } from '../../lib/passenger-driver';

/**
 * The driver's assigned departures — the movement surface. The list endpoint
 * requires an APPROVED PASSENGER_DRIVER role (moving people is gated harder
 * than editing a profile), so a 403 here is rendered as the approval
 * requirement it is, not as a broken page. Start/complete are offered from
 * the trip's status; the server enforces the transitions and its refusals
 * are shown verbatim.
 */
export function TripsList() {
  const [trips, setTrips] = useState<PassengerTrip[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTrips(await api.get<PassengerTrip[]>('/passenger/driver/trips'));
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
  if (notApproved) {
    return (
      <Alert tone="info" title="Approval required">
        Departures appear here once your passenger-driver application is approved. You can check its status in{' '}
        <a className="font-semibold underline" href="/dashboard/roles">
          My Roles
        </a>
        .
      </Alert>
    );
  }
  if (err) return <Alert tone="error">{err}</Alert>;
  if (!trips || trips.length === 0) {
    return (
      <EmptyState
        title="No departures assigned"
        description="When an operator or administrator assigns you a departure, it appears here with its route and scheduled time."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {trips.map((t) => (
        <TripRow key={t.id} trip={t} onChanged={reload} />
      ))}
    </ul>
  );
}

function TripRow({ trip, onChanged }: { trip: PassengerTrip; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = tripAction(trip.status);
  const journey = trip.from && trip.to ? `${trip.from} → ${trip.to}` : null;

  async function perform(action: 'start' | 'complete') {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/passenger/driver/trips/${trip.id}/${action}`, {});
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
              <b className="text-sm text-belize-navy">{trip.routeName ?? 'Departure'}</b>
              <StatusBadge status={trip.status} />
              <Badge tone="neutral">{trip.reference}</Badge>
            </div>
            {journey && <p className="mt-1 text-sm text-slate-600">{journey}</p>}
            <p className="mt-1 text-sm text-slate-500">
              Departs {new Date(trip.scheduledDepartureAt).toLocaleString()}
              {trip.seatCapacity != null && <> · {trip.seatCapacity} seats</>}
            </p>
            {trip.operator && <p className="mt-1 text-xs text-slate-500">Operator: {trip.operator}</p>}
          </div>
          {act && (
            <Button size="sm" disabled={busy} onClick={() => perform(act.action)}>
              {busy ? 'Working…' : act.label}
            </Button>
          )}
        </div>
        {err && (
          <Alert tone="error" className="mt-3">
            {err}
          </Alert>
        )}
      </UiCard>
    </li>
  );
}
