'use client';

import { PageHeader } from '../../../../components/ui';
import { OperatorBreadcrumb } from '../../../../components/passenger-operator/data';
import { BookingsPanel } from '../../../../components/passenger-operator/BookingsPanel';

export default function OperatorBookingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OperatorBreadcrumb current="Bookings" />
      <PageHeader title="Bookings" description="Riders' seat requests on your departures, for you to confirm or cancel." />
      <BookingsPanel />
    </div>
  );
}
