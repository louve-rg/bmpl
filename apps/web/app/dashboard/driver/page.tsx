'use client';

import Link from 'next/link';
import { PageHeader } from '../../../components/ui';
import { DriverOperations } from '../../../components/dashboard/DriverOperations';
import { AvailabilityControl } from '../../../components/driver/AvailabilityControl';
import { ProfileEditor } from '../../../components/driver/ProfileEditor';
import { StatusBanner } from '../../../components/driver/StatusBanner';
import { DriverPageShell } from '../../../components/driver/dashboard-data';

/**
 * The Driver Dashboard — an operational command centre, not a settings page.
 *
 * It used to be a single 1,000-line screen carrying availability, operations,
 * the profile form, the vehicle manager and the service-area picker, in that
 * order. A driver who wanted their service areas scrolled past three forms to
 * find them, and the navigation had nothing to point at but the top of the page.
 *
 * Now: availability first (the question a driver opens this to settle), current
 * work second, and everything else is a link to a page that owns it. The one
 * exception is a driver with NO profile yet — for them the profile form IS the
 * dashboard, because there is nothing else they can usefully do.
 */
export default function DriverDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Driver Dashboard"
        description="Your shift at a glance — availability, current work, earnings and performance."
      />

      <DriverPageShell requiresProfile={false}>
        {(data, reload) => (
          <div className="space-y-5">
            <StatusBanner hasProfile={data.hasProfile} roleStatus={data.roleStatus} application={data.application} />

            {/* Availability first: 'am I available for work right now?' is the
                question a driver opens this page to settle. */}
            {data.profile && <AvailabilityControl profile={data.profile} eligibility={data.eligibility} onDone={reload} />}

            {data.operations && <DriverOperations ops={data.operations} />}

            {data.hasProfile ? (
              <QuickActions />
            ) : (
              // No profile yet — the application form is the only useful thing on
              // the screen, so it stays inline rather than behind another click.
              <ProfileEditor profile={data.profile} onDone={reload} />
            )}
          </div>
        )}
      </DriverPageShell>
    </div>
  );
}

/**
 * The dashboard's shortcuts. My Deliveries and My Earnings lead because they are
 * what a driver came for; the management pages sit under them as a compact list
 * rather than four more large cards.
 */
function QuickActions() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <PrimaryAction
          href="/dashboard/driver/jobs"
          title="My Deliveries"
          description="Available, assigned, active and completed work — plus your route."
          icon="M3 7h11v9H3z M14 10h4l3 3v3h-7"
        />
        <PrimaryAction
          href="/dashboard/driver/earnings"
          title="My Earnings"
          description="What you’ve earned and how each delivery was calculated."
          icon="M12 3v18 M6 8h9a3 3 0 0 1 0 6H8"
        />
      </div>

      <nav aria-label="Manage your driver account" className="bmpl-card divide-y divide-slate-100 p-1">
        {[
          { href: '/dashboard/driver/profile', label: 'Driver Profile', hint: 'Contact details, licence, photo' },
          { href: '/dashboard/driver/vehicles', label: 'Vehicle Profile', hint: 'Vehicles, registration, insurance' },
          { href: '/dashboard/driver/documents', label: 'Application & Documents', hint: 'Application status and uploads' },
          { href: '/dashboard/driver/service-areas', label: 'Service Areas', hint: 'Districts you deliver in' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-[52px] items-center gap-3 rounded-bmpl-md px-3 py-2.5 transition hover:bg-slate-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-belize-navy">{item.label}</span>
              <span className="block truncate text-xs text-slate-500">{item.hint}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function PrimaryAction({ href, title, description, icon }: { href: string; title: string; description: string; icon: string }) {
  return (
    <Link
      href={href}
      className="bmpl-card flex min-h-[44px] items-start gap-3 p-4 transition hover:border-belize-blue/40 hover:shadow-bmpl-md"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-bmpl-md bg-belize-blue/10 text-belize-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-belize-navy">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </Link>
  );
}
