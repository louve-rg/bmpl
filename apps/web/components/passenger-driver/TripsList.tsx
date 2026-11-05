'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Spinner, StatusBadge } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { tripAction, type DriverTripHistory, type PassengerTrip } from '../../lib/passenger-driver';
import { TripBookings } from './TripBookings';

const HISTORY_PAGE_SIZE = 20;

/**
 * The driver's departures — the movement surface. With no `status` (the
 * default, My Departures), this is unchanged from before: a bare array,
 * ASSIGNED/IN_PROGRESS only, no pagination. Passing `status="COMPLETED"`
 * (MDF-554, trip history) switches the same endpoint to a different, real
 * paginated query, reused here rather than a second list component — a
 * completed trip finishes on the server (`completeTrip`) but had nowhere in
 * the driver's own navigation to be read back; Jim found this live, the one
 * blocker across the whole product.
 *
 * The list endpoint requires an APPROVED PASSENGER_DRIVER role (moving
 * people is gated harder than editing a profile) on either path, so a 403
 * here is rendered as the approval requirement it is, not as a broken page.
 * Start/complete are offered from the trip's status; `tripAction` already
 * returns nothing for COMPLETED, so the history view never offers them.
 */
export function TripsList({ status }: { status?: string } = {}) {
  const [trips, setTrips] = useState<PassengerTrip[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const path = status
        ? `/passenger/driver/trips?status=${status}&page=${page}&pageSize=${HISTORY_PAGE_SIZE}`
        : '/passenger/driver/trips';
      const data = await api.get<PassengerTrip[] | DriverTripHistory>(path);
      if (Array.isArray(data)) {
        setTrips(data);
        setTotal(data.length);
      } else {
        setTrips(data.rows);
        setTotal(data.total);
      }
      setNotApproved(false);
      setErr(null);
    } catch (e) {
      if ((e as ApiError).status === 403) setNotApproved(true);
      else setErr(errMessage(e));
    }
  }, [status, page]);

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
    return status ? (
      <EmptyState title="No completed trips yet" description="Departures you complete appear here, with when you finished them." />
    ) : (
      <EmptyState
        title="No departures assigned"
        description="When an operator or administrator assigns you a departure, it appears here with its route and scheduled time."
      />
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {trips.map((t) => (
          <TripRow key={t.id} trip={t} onChanged={reload} />
        ))}
      </ul>
      {status && total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            Showing {(page - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(page * HISTORY_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page * HISTORY_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function TripRow({ trip, onChanged }: { trip: PassengerTrip; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showBookings, setShowBookings] = useState(false);
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
            {trip.completedAt && (
              <p className="mt-1 text-xs text-slate-500">Completed {new Date(trip.completedAt).toLocaleString()}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowBookings((v) => !v)}>
              {showBookings ? 'Hide passengers' : 'View passengers'}
            </Button>
            {act && (
              <Button size="sm" disabled={busy} onClick={() => perform(act.action)}>
                {busy ? 'Working…' : act.label}
              </Button>
            )}
          </div>
        </div>
        {err && (
          <Alert tone="error" className="mt-3">
            {err}
          </Alert>
        )}
        {showBookings && <TripBookings tripId={trip.id} />}
      </UiCard>
    </li>
  );
}
