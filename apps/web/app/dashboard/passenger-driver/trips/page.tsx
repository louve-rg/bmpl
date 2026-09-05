'use client';

import { PageHeader } from '../../../../components/ui';
import { PassengerDriverBreadcrumb } from '../../../../components/passenger-driver/data';
import { TripsList } from '../../../../components/passenger-driver/TripsList';

export default function PassengerDriverTripsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PassengerDriverBreadcrumb current="My Departures" />
      <PageHeader title="My Departures" description="The departures assigned to you — start when you leave, complete when everyone is delivered." />
      {/* No shell: this list has its own gate (an APPROVED role), which it
          explains itself rather than asking for a profile it doesn't need. */}
      <TripsList />
    </div>
  );
}
