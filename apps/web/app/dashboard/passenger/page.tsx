'use client';

import Link from 'next/link';
import { PageHeader } from '../../../components/ui';
import { DeparturesList } from '../../../components/travel/DeparturesList';

/**
 * The rider's side of the Passenger Service — the demand half of the vertical,
 * and the page that finally lets a customer USE what the supply side built:
 * browse published departures and request seats. The fare gate and the
 * held-at-confirmation rule are carried by DeparturesList; this page adds only
 * the way to the rider's own bookings.
 */
export default function PassengerServicePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Passenger Service"
          description="Upcoming departures across Belize — request seats, and the operator confirms."
        />
        <Link
          href="/dashboard/passenger/bookings"
          className="rounded-bmpl-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5"
        >
          My Bookings
        </Link>
      </div>
      <DeparturesList />
    </div>
  );
}
