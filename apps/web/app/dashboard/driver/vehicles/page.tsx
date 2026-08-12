'use client';

import { Alert, PageHeader } from '../../../../components/ui';
import { VehicleManager } from '../../../../components/driver/VehicleManager';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';
import { DriverPageShell } from '../../../../components/driver/dashboard-data';

export default function DriverVehiclesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="Vehicle Profile" />
      <PageHeader title="Vehicle Profile" description="The vehicles you deliver with, and their approval status." />
      <DriverPageShell>
        {(data, reload) => (
          <div className="space-y-5">
            {/* An unapproved vehicle is the most common reason a driver cannot go
                online, so the eligibility blockers are repeated here rather than
                leaving them to guess why the dashboard refuses. */}
            {!data.eligibility.canGoOnline && data.eligibility.reasons.length > 0 && (
              <Alert tone="warning" title="You can’t go online yet">
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {data.eligibility.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <VehicleManager vehicles={data.vehicles} onDone={reload} />
          </div>
        )}
      </DriverPageShell>
    </div>
  );
}
