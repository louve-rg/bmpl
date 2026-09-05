'use client';

import { PageHeader } from '../../../../components/ui';
import { PassengerDriverBreadcrumb, PassengerDriverShell } from '../../../../components/passenger-driver/data';
import { ProfileForm } from '../../../../components/passenger-driver/ProfileForm';

export default function PassengerDriverProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PassengerDriverBreadcrumb current="Passenger Profile" />
      <PageHeader title="Passenger Profile" description="Your contact details and driver's licence for passenger transport." />
      {/* Useful before a profile exists — this form is how one is created. */}
      <PassengerDriverShell requiresProfile={false}>
        {(data, reload) => <ProfileForm profile={data.profile} onDone={reload} />}
      </PassengerDriverShell>
    </div>
  );
}
