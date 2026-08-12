'use client';

import { PageHeader } from '../../../../components/ui';
import { ProfileEditor } from '../../../../components/driver/ProfileEditor';
import { RatingSummary } from '../../../../components/driver/StatusBanner';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';
import { DriverPageShell } from '../../../../components/driver/dashboard-data';

export default function DriverProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="Driver Profile" />
      <PageHeader title="Driver Profile" description="Your contact details, licence and the photo customers see." />
      <DriverPageShell>
        {(data, reload) => (
          <div className="space-y-5">
            {data.profile && <RatingSummary profile={data.profile} />}
            <ProfileEditor profile={data.profile} onDone={reload} />
          </div>
        )}
      </DriverPageShell>
    </div>
  );
}
