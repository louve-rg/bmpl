'use client';

import { PageHeader } from '../../../../components/ui';
import { CarrierShell, CarrierBreadcrumb } from '../../../../components/shipping-provider/data';
import { OrgStatusCard } from '../../../../components/shipping-provider/StatusBanner';
import { CarrierProfileForm } from '../../../../components/shipping-provider/ProfileForm';

export default function CarrierProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <CarrierBreadcrumb current="Organization Profile" />
      <PageHeader title="Organization Profile" description="Edit your organization's details." />

      <CarrierShell>
        {(data, reload) => (
          <div className="space-y-5">
            {data.profile && <OrgStatusCard profile={data.profile} onChanged={reload} />}
            <CarrierProfileForm profile={data.profile} onDone={reload} />
          </div>
        )}
      </CarrierShell>
    </div>
  );
}
