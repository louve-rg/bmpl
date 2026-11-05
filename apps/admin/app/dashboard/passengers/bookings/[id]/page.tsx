'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { Badge, Breadcrumbs, Card, Spinner } from '../../../../../components/ui';
import { adminCrumbs } from '../../../../../lib/admin-nav';
import { AddressMapPreview } from '../../../../../components/maps/AddressMapPreview';
import type { MapPoint } from '../../../../../lib/trip-map';

/**
 * MDF-549, admin half. god's own correction: `passengers/[id]` is the
 * driver-vetting screen, keyed by a DRIVER id -- not a booking detail route,
 * which did not exist until this file. Keyed by booking `id` (not
 * `reference`) because `BookingRow` already carries it.
 *
 * `GET admin/passengers/bookings/:id` (plural "passengers" -- the existing
 * controller prefix, `@Controller('admin/passengers')`; an earlier relayed
 * instruction said the singular path and was wrong) was added by Pam on
 * `feat/passenger-api-booking-pins`, guarded by
 * `@RequirePermission('passengers.read')`, reusing `serializeBooking()`.
 * This retires the original version of this page's own list-fetch-and-filter
 * (`listBookings()` caps at 300 rows, so that version silently 404'd on any
 * real booking outside the 300 most recent -- god caught this, not a minor
 * inefficiency as first reported). Fetches the one booking directly, same
 * pattern as `orders/[id]/page.tsx`.
 */

/**
 * One end of a booking's pickup/drop-off snapshot -- the real, NESTED shape
 * `serializeBooking()` emits (`pickup: this.serializeBookingStop(b, 'pickup')`),
 * `null` wholesale when that end was never pinned, never individually-absent
 * fields. (MDF-549 gap A: this file originally declared FLAT `pickupDistrict`/
 * `pickupCity`/... fields the API never sends, under a comment claiming they
 * were "absent until shipped" -- that was true when written and silently
 * stopped being true once Pam shipped the nested shape; the page typechecked
 * against its own wrong assumption instead of the server and always rendered
 * "Not specified", even for a booking with real pins. Caught live by Dwight,
 * fixed by reading the real shape instead of re-declaring one.) Matches
 * `apps/web/lib/passenger-driver.ts`'s `TripBookingLocation` field-for-field --
 * can't share the type across apps, so kept in sync by hand. District/city are
 * what price the booking and match a driver; a street or a pin may be either
 * or both absent -- a pin never implies them (root CLAUDE.md, settled MDF-485).
 */
interface BookingEndSnapshot {
  district: string | null;
  city: string | null;
  address: string | null;
  landmark: string | null;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface BookingDetail {
  id: string;
  reference: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
  seats: number;
  isTest: boolean;
  tripReference: string | null;
  tripStatus: string | null;
  scheduledDepartureAt: string | null;
  routeName: string | null;
  from: string | null;
  to: string | null;
  passengerName: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  pickup: BookingEndSnapshot | null;
  dropoff: BookingEndSnapshot | null;
}

/** Mirrors `BookingsTab`'s own map in `../../page.tsx` -- keep both in sync. */
const BOOKING_TONE: Record<BookingDetail['status'], 'info' | 'success' | 'neutral' | 'warning'> = {
  REQUESTED: 'info',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'warning',
  EXPIRED: 'neutral',
};

const when = (iso: string) => new Date(iso).toLocaleString();

/** What a human reads for one end -- street if given, otherwise the landmark, otherwise just town/district. */
function endLine(end: BookingEndSnapshot): string {
  if (end.address) return [end.address, end.city, end.district].filter(Boolean).join(', ');
  if (end.landmark) return [end.landmark, end.city, end.district].filter(Boolean).join(', ');
  if (end.city || end.district) return [end.city, end.district].filter(Boolean).join(', ');
  return 'Not given';
}

function EndCard({ title, end }: { title: string; end: BookingEndSnapshot | null }) {
  return (
    <Card className="p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">{title}</p>
      {end ? (
        <>
          <p className="mt-1 break-words text-[color:var(--bmpl-text-muted)]">{endLine(end)}</p>
          {end.landmark && end.address && <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">Landmark: {end.landmark}</p>}
          {end.instructions && <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">Instructions: {end.instructions}</p>}
        </>
      ) : (
        // Pickup/drop-off are optional on a booking (MDF-549) -- the route's
        // own stop is the normal case, not a gap to flag as missing data.
        <p className="mt-1 text-[color:var(--bmpl-text-muted)]">Not specified — travelling to/from the route&rsquo;s own stop.</p>
      )}
    </Card>
  );
}

/** Mirrors `apps/web`'s own `endPoint()` in `TripBookings.tsx` -- same shape, kept in sync by hand. */
function endPoint(label: string, end: BookingEndSnapshot | null): MapPoint | null {
  if (!end || end.latitude == null || end.longitude == null) return null;
  return {
    latitude: end.latitude,
    longitude: end.longitude,
    label: `${label}: ${end.address ?? end.landmark ?? [end.city, end.district].filter(Boolean).join(', ')}`,
  };
}

export default function AdminBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    api
      .get<BookingDetail>(`/admin/passengers/bookings/${params.id}`)
      .then((b) => {
        setBooking(b);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [params.id]);

  if (state === 'loading')
    return (
      <div>
        <Breadcrumbs items={adminCrumbs(['Passengers', '/dashboard/passengers'], 'Booking')} className="mb-3" />
        <div className="flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </div>
    );
  if (state === 'error' || !booking)
    return (
      <div>
        <Breadcrumbs items={adminCrumbs(['Passengers', '/dashboard/passengers'], 'Booking')} className="mb-3" />
        <p className="text-sm text-[color:var(--bmpl-text-muted)]">Booking not found.</p>
      </div>
    );

  const pickup = booking.pickup;
  const dropoff = booking.dropoff;

  return (
    <div>
      <Breadcrumbs items={adminCrumbs(['Passengers', '/dashboard/passengers'], booking.reference)} className="mb-3" />
      <Link href="/dashboard/passengers" className="text-sm font-medium text-belize-blue hover:underline">← Passengers</Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="bmpl-page-title">{booking.reference}</h1>
          <p className="mt-1 min-w-0 break-words text-sm text-[color:var(--bmpl-text-muted)]">
            {booking.passengerName ?? '—'} · {booking.seats} seat{booking.seats === 1 ? '' : 's'} · {when(booking.createdAt)}
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge tone={BOOKING_TONE[booking.status]}>{booking.status.replace(/_/g, ' ').toLowerCase()}</Badge>
          {booking.isTest && <Badge tone="neutral">Simulation</Badge>}
        </span>
      </div>

      <Card className="mt-4 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">Departure</p>
        <p className="mt-1 text-[color:var(--bmpl-text-muted)]">
          {booking.routeName ?? '—'}
          {booking.from && booking.to ? ` · ${booking.from} → ${booking.to}` : ''}
        </p>
        <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
          {booking.tripReference ? `Departure ${booking.tripReference}` : 'No departure attached'}
          {booking.tripStatus ? ` (${booking.tripStatus.replace(/_/g, ' ').toLowerCase()})` : ''}
          {booking.scheduledDepartureAt ? ` · departs ${when(booking.scheduledDepartureAt)}` : ''}
        </p>
        {booking.cancellationReason && (
          <p className="mt-2 text-xs font-medium text-amber-800">
            Cancelled{booking.cancelledBy ? ` by ${booking.cancelledBy.toLowerCase()}` : ''}: {booking.cancellationReason}
          </p>
        )}
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <EndCard title="Pickup" end={pickup} />
        <EndCard title="Drop-off" end={dropoff} />
      </div>

      {/* Read-only, tap-to-load, no editing here -- against the written
          text above, not instead of it, same as the order/shipment previews
          this ports from (MDF-538). Shows nothing until at least one end
          actually has a pin, which is honest: pickup/drop-off are optional
          on a booking, so having neither is the normal case, not an error. */}
      <AddressMapPreview
        points={[endPoint('Pickup', pickup), endPoint('Drop-off', dropoff)].filter((p): p is MapPoint => p !== null)}
        title={`${booking.reference} · pickup & drop-off`}
        className="mt-4"
      />
    </div>
  );
}
