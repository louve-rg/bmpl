'use client';

import { PageHeader } from '../../../../components/ui';
import { ServiceAreasSection } from '../../../../components/driver/ServiceAreasSection';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';
import { DriverPageShell } from '../../../../components/driver/dashboard-data';

export default function DriverServiceAreasPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="Service Areas" />
      <PageHeader
        title="Service Areas"
        description="Deliveries are only offered to you in the districts you cover here."
      />
      <DriverPageShell>
        {(data, reload) => <ServiceAreasSection serviceAreas={data.serviceAreas} onDone={reload} />}
      </DriverPageShell>
    </div>
  );
}
