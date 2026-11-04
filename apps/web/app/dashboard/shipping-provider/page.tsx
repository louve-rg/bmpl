'use client';

import Link from 'next/link';
import { Card, PageHeader } from '../../../components/ui';
import { CarrierShell } from '../../../components/shipping-provider/data';
import { RoleStatusBanner, OrgStatusCard } from '../../../components/shipping-provider/StatusBanner';
import { CarrierProfileForm } from '../../../components/shipping-provider/ProfileForm';

/**
 * The Carrier Dashboard (MDF-526) — the self-service surface Jim's checklist
 * found missing entirely: before this, a carrier could only work a leg if a
 * developer called the API with a token. Mirrors the operator/vendor
 * model: the carrier self-serves here, the admin console reaches across
 * every carrier. For a visitor with NO organization profile yet, the
 * profile form IS the dashboard.
 */
export default function CarrierDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Carrier Dashboard"
        description="Your shipping organization — profile, legs and routes."
      />

      <CarrierShell requiresProfile={false}>
        {(data, reload) => (
          <div className="space-y-5">
            <RoleStatusBanner hasProfile={!!data.profile} roleStatus={data.roleStatus} />
            {data.profile ? (
              <>
                <OrgStatusCard profile={data.profile} onChanged={reload} />
                <Card title="Quick links">
                  <ul className="space-y-1 text-sm">
                    <li>
                      <Link className="font-medium text-[color:var(--bmpl-link)] hover:underline" href="/dashboard/shipping-provider/legs">
                        My Legs — assigned, proposed, departed and arrived
                      </Link>
                    </li>
                    <li>
                      <Link className="font-medium text-[color:var(--bmpl-link)] hover:underline" href="/dashboard/shipping-provider/routes">
                        My Routes — claim, release, and set a weekly schedule
                      </Link>
                    </li>
                    <li>
                      <Link className="font-medium text-[color:var(--bmpl-link)] hover:underline" href="/dashboard/shipping-provider/profile">
                        Organization Profile
                      </Link>
                    </li>
                  </ul>
                </Card>
              </>
            ) : (
              <CarrierProfileForm profile={null} onDone={reload} />
            )}
          </div>
        )}
      </CarrierShell>
    </div>
  );
}
