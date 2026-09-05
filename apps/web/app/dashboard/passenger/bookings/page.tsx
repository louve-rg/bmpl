'use client';

import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { MyBookings } from '../../../../components/travel/MyBookings';

export default function PassengerBookingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
          <li>
            <Link
              href="/dashboard/passenger"
              className="font-medium text-belize-blue transition hover:text-belize-deep hover:underline"
            >
              Passenger Service
            </Link>
          </li>
          <li aria-hidden className="text-slate-300">
            /
          </li>
          <li aria-current="page" className="min-w-0 truncate font-medium text-slate-600">
            My Bookings
          </li>
        </ol>
      </nav>
      <PageHeader title="My Bookings" description="Your seat requests and confirmed seats, and the operator's answers." />
      <MyBookings />
    </div>
  );
}
