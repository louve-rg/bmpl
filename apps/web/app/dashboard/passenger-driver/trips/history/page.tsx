'use client';

import { PageHeader } from '../../../../../components/ui';
import { PassengerDriverBreadcrumb } from '../../../../../components/passenger-driver/data';
import { TripsList } from '../../../../../components/passenger-driver/TripsList';

export default function PassengerDriverTripHistoryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PassengerDriverBreadcrumb current="Trip History" />
      <PageHeader title="Trip History" description="Departures you've completed, with when you finished each one." />
      {/* No shell: same gate as My Departures (an APPROVED role), which the
          list explains itself. */}
      <TripsList status="COMPLETED" />
    </div>
  );
}
