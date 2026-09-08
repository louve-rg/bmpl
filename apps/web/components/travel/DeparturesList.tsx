'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MAX_PASSENGER_SEATS } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { formatBzd } from '../../lib/passenger-operator';
import { riderAccessView, seatsLeft, type Departure } from '../../lib/passenger-travel';

/**
 * Published departures a rider can ask to travel on.
 *
 * The fare gate is the whole story here: `fareConfigured` is the SERVER's
 * answer, and a departure without a fare renders the plain reason in place of
 * any booking control — nothing on this screen can attempt to book around it.
 * A configured fare renders verbatim (minor units as returned) labelled just
 * "Fare": whether that figure is per seat or per booking is commercial policy
 * nobody has set, so no unit and no multiplication appears anywhere, however
 * many seats are asked for.
 *
 * Booking honesty: a request RESERVES NOTHING — seats are held only when the
 * operator confirms. The form says so before submission and the success
 * message repeats it, because a person will plan travel around these words.
 */
export function DeparturesList() {
  const [rows, setRows] = useState<Departure[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.get<Departure[]>('/passenger/departures'));
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (err) {
    // A restricted account (suspended customer role) is told calmly, in the
    // server's words — a decision about the account is not a malfunction.
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
        title="No departures scheduled"
        description="When an operator publishes an upcoming departure, it appears here with its route, time and fare. Services shows what runs even when nothing is scheduled yet."
        action={
          <Link
            href="/dashboard/passenger/services"
            className="rounded-bmpl-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5"
          >
            Browse services
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((d) => (
        <DepartureCard key={d.id} departure={d} onBooked={reload} detailHref={`/dashboard/passenger/departures/${d.id}`} />
      ))}
    </div>
  );
}

export function DepartureCard({
  departure: d,
  onBooked,
  detailHref,
}: {
  departure: Departure;
  onBooked: () => Promise<void>;
  /** Link to the departure's stops/detail page — omitted when the card IS that page. */
  detailHref?: string;
}) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const left = seatsLeft(d.seatCapacity, d.seatsConfirmed);

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">{d.route.name}</b>
            {d.operator && <span className="text-xs text-slate-500">{d.operator}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {d.route.originCity} → {d.route.destinationCity}
            {d.route.durationMinutes != null ? ` · ~${d.route.durationMinutes} min` : ''}
          </p>
          <p className="mt-1 text-sm text-slate-500">Departs {new Date(d.scheduledDepartureAt).toLocaleString()}</p>
          {d.route.scheduleNote && <p className="mt-0.5 text-xs text-slate-500">{d.route.scheduleNote}</p>}

          {d.fareConfigured && d.baseFareMinor != null ? (
            <p className="mt-1 text-sm text-slate-700">Fare {formatBzd(d.baseFareMinor)}</p>
          ) : (
            // The fare gate, in the rider's language, in place of any control.
            <p className="mt-1 text-sm font-medium text-amber-700">
              This departure can&rsquo;t be booked yet — the operator hasn&rsquo;t published its fare.
            </p>
          )}

          <p className="mt-1 text-xs text-slate-500">
            {left == null
              ? 'Seats: not yet announced.'
              : left === 0
                ? 'Currently full — a request now can only be confirmed if seats free up.'
                : `${left} seat${left === 1 ? '' : 's'} available`}
          </p>
          {detailHref && (
            <Link href={detailHref} className="mt-1 inline-block text-sm font-semibold text-belize-blue hover:underline">
              Stops &amp; details
            </Link>
          )}
        </div>

        {d.fareConfigured && !bookingOpen && !requested && (
          <Button type="button" size="sm" onClick={() => setBookingOpen(true)}>
            Request seats
          </Button>
        )}
      </div>

      {requested && (
        <Alert tone="success" className="mt-3" title="Request sent">
          The operator must confirm it — <b>no seat is held yet</b>. Watch{' '}
          <Link href="/dashboard/passenger/bookings" className="font-semibold underline">
            My Bookings
          </Link>{' '}
          for the answer.
        </Alert>
      )}

      {bookingOpen && (
        <BookingForm
          tripId={d.id}
          onClose={() => setBookingOpen(false)}
          onDone={async () => {
            setBookingOpen(false);
            setRequested(true);
            await onBooked();
          }}
        />
      )}
    </UiCard>
  );
}

function BookingForm({ tripId, onClose, onDone }: { tripId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [seats, setSeats] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/bookings', { tripId, seats: Number(seats) });
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3 rounded-bmpl-md border border-slate-200 p-3" onSubmit={submit}>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Seats" htmlFor={`${tripId}-seats`}>
        <Input
          id={`${tripId}-seats`}
          type="number"
          min={1}
          max={MAX_PASSENGER_SEATS}
          className="w-24"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          required
        />
      </Field>
      <p className="text-xs text-slate-600">
        This sends a request to the operator. <b>Your seats are only held once the operator confirms</b> — until then,
        nothing is reserved.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !seats}>
          Send request
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
