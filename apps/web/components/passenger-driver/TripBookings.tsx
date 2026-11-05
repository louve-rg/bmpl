'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Card, EmptyState, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { tripBookingEndLine, type TripBooking } from '../../lib/passenger-driver';
import { ExpandableRouteMap } from '../maps/ExpandableRouteMap';
import type { MapPoint } from '../../lib/trip-map';

/** Mirrors admin's own map in `passengers/bookings/[id]/page.tsx` -- keep both in sync. */
const BOOKING_TONE: Record<TripBooking['status'], 'info' | 'success' | 'neutral' | 'warning'> = {
  REQUESTED: 'info',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'warning',
  EXPIRED: 'neutral',
};

/**
 * A trip's passenger bookings, for the driver assigned to it (MDF-549,
 * MDF-548's `GET /passenger/driver/trips/:id/bookings`). Fetched only while
 * the caller keeps this mounted (TripsList expands/collapses it per row),
 * same on-demand shape as the map tiles underneath it.
 *
 * No rider name or phone on this payload by design (god's ruling, asserted
 * in Pam's own test) -- each booking identifies itself by reference and
 * seat count only. A trip the driver is not assigned to returns 200 with an
 * empty array, not 404, so an empty list renders as the normal "nothing to
 * show" case, not an error.
 */
export function TripBookings({ tripId }: { tripId: string }) {
  const [bookings, setBookings] = useState<TripBooking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBookings(null);
    setErr(null);
    api
      .get<TripBooking[]>(`/passenger/driver/trips/${tripId}/bookings`)
      .then((rows) => {
        if (!cancelled) setBookings(rows);
      })
      .catch((e) => {
        if (!cancelled) setErr(errMessage(e as ApiError));
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (err)
    return (
      <Alert tone="error" className="mt-3">
        {err}
      </Alert>
    );
  if (!bookings) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading passengers…
      </div>
    );
  }
  if (bookings.length === 0) {
    return (
      <div className="mt-3">
        <EmptyState title="No passengers yet" description="Bookings for this departure appear here once a passenger requests a seat." />
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-2">
      {bookings.map((b) => (
        <li key={b.id}>
          <BookingRow booking={b} />
        </li>
      ))}
    </ul>
  );
}

function endPoint(label: string, end: TripBooking['pickup']): MapPoint | null {
  if (end?.latitude == null || end.longitude == null) return null;
  return {
    latitude: end.latitude,
    longitude: end.longitude,
    label: `${label}: ${end.address ?? end.landmark ?? [end.city, end.district].filter(Boolean).join(', ')}`,
  };
}

function BookingRow({ booking }: { booking: TripBooking }) {
  const points: MapPoint[] = [endPoint('Pickup', booking.pickup), endPoint('Drop-off', booking.dropoff)].filter(
    (p): p is MapPoint => p !== null,
  );

  return (
    <Card className="p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={BOOKING_TONE[booking.status]}>{booking.status.replace(/_/g, ' ').toLowerCase()}</Badge>
        <span className="font-semibold text-belize-navy">{booking.reference}</span>
        <span className="text-slate-500">
          {booking.seats} seat{booking.seats === 1 ? '' : 's'}
        </span>
        {booking.isTest && <Badge tone="neutral">Simulation</Badge>}
      </div>

      <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Pickup</dt>
          <dd className="mt-0.5">{tripBookingEndLine(booking.pickup)}</dd>
          {booking.pickup?.instructions && <dd className="mt-0.5">Instructions: {booking.pickup.instructions}</dd>}
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Drop-off</dt>
          <dd className="mt-0.5">{tripBookingEndLine(booking.dropoff)}</dd>
          {booking.dropoff?.instructions && <dd className="mt-0.5">Instructions: {booking.dropoff.instructions}</dd>}
        </div>
      </dl>

      <ExpandableRouteMap points={points} title={`${booking.reference} · pickup & drop-off`} className="mt-2" />
    </Card>
  );
}
