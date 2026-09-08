'use client';

import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { ServicesList } from '../../../../components/travel/ServicesList';

/**
 * Service discovery — what runs at all, independent of what is scheduled
 * right now. Before this page, an empty departures list told a rider nothing,
 * not even that the road is served. Discovery only: booking always belongs to
 * a concrete departure, behind the fare gate.
 */
export default function PassengerServicesPage() {
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
            Services
          </li>
        </ol>
      </nav>
      <PageHeader
        title="Services"
        description="Passenger services operators run across Belize — their routes, stops and fares, even before a departure is scheduled."
      />
      <ServicesList />
    </div>
  );
}
