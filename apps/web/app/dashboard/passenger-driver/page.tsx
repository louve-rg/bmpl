'use client';

import { PageHeader } from '../../../components/ui';
import { PassengerDriverShell } from '../../../components/passenger-driver/data';
import { PassengerStatusBanner } from '../../../components/passenger-driver/StatusBanner';
import { AvailabilityCard } from '../../../components/passenger-driver/AvailabilityCard';
import { FleetCard } from '../../../components/passenger-driver/FleetCard';
import { ProfileForm } from '../../../components/passenger-driver/ProfileForm';

/**
 * The Passenger Dashboard — the passenger-transport counterpart of the Driver
 * Dashboard, deliberately its own surface: carrying passengers is a different
 * job from carrying parcels, with its own role, vehicles and vocabulary.
 *
 * Availability first (the question a working driver opens this to settle),
 * the fleet seat next (BMPL-39's affiliation card mounts there when its API
 * lands), and for a visitor with NO profile yet the profile form IS the
 * dashboard — there is nothing else they can usefully do.
 */
export default function PassengerDriverDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Passenger Dashboard"
        description="Your passenger-transport shift at a glance — availability, your assigned departures, your fleet."
      />

      <PassengerDriverShell requiresProfile={false}>
        {(data, reload) => (
          <div className="space-y-5">
            <PassengerStatusBanner hasProfile={!!data.profile} roleStatus={data.roleStatus} />

            {data.profile ? (
              <>
                <AvailabilityCard profile={data.profile} eligibility={data.eligibility} onDone={reload} />
                <FleetCard />
              </>
            ) : (
              <ProfileForm profile={null} onDone={reload} />
            )}
          </div>
        )}
      </PassengerDriverShell>
    </div>
  );
}
