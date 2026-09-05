'use client';

import { PageHeader } from '../../../components/ui';
import { OperatorShell } from '../../../components/passenger-operator/data';
import { OperatorStatusBanner } from '../../../components/passenger-operator/StatusBanner';
import { OperatorProfileForm } from '../../../components/passenger-operator/ProfileForm';
import { FleetRosterCard } from '../../../components/passenger-operator/FleetRosterCard';

/**
 * The Operator Dashboard — the fleet operator's home, the vendors-and-products
 * model applied to passenger transport: the operator self-serves here, the
 * admin console reaches across all operators. For a visitor with NO business
 * profile yet the profile form IS the dashboard; the fleet roster seat mounts
 * here (see FleetRosterCard for why it is empty).
 */
export default function OperatorDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Operator Dashboard"
        description="Your passenger transport business — profile, fleet, routes and departures."
      />

      <OperatorShell requiresProfile={false}>
        {(data, reload) => (
          <div className="space-y-5">
            <OperatorStatusBanner hasProfile={!!data.profile} roleStatus={data.roleStatus} />
            {data.profile ? <FleetRosterCard providerProfileId={data.profile.id} /> : <OperatorProfileForm profile={null} onDone={reload} />}
          </div>
        )}
      </OperatorShell>
    </div>
  );
}
