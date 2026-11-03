'use client';

import { Alert, PageHeader } from '../../../../components/ui';
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
        {(data, reload) => (
          <div className="space-y-5">
            {/* Same shape as vehicles/page.tsx: no service areas selected is one
                of the most common reasons a driver cannot go online, so the
                eligibility blockers are repeated here too, rather than leaving
                a driver who landed on this page to guess why the dashboard
                refuses. */}
            {!data.eligibility.canGoOnline && data.eligibility.reasons.length > 0 && (
              <Alert tone="warning" title="You can’t go online yet">
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {data.eligibility.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <ServiceAreasSection serviceAreas={data.serviceAreas} onDone={reload} />
          </div>
        )}
      </DriverPageShell>
    </div>
  );
}
