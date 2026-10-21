import Link from 'next/link';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../lib/server-api';
import type { MeView } from '../../lib/types';
import { Card, PageHeader, StatusBadge } from '../../components/ui';
import { ForYou } from '../../components/discovery/ForYou';
import { VerifyEmailBanner } from '../../components/VerifyEmailBanner';

export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  const me = (await serverGet<MeView>('/me'))!;
  const activeLabel = me.activeRole ? ROLE_DEFINITIONS[me.activeRole as RoleCode].label : 'Customer';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={`Signed in as ${activeLabel}`} title={`Welcome, ${me.firstName}`} />

      {!me.emailVerified && <VerifyEmailBanner email={me.email} />}

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active role" value={activeLabel} />
        <StatCard label="Roles held" value={String(me.roles.length)} />
        <StatCard
          label="Approved roles"
          value={String(me.roles.filter((r) => r.status === 'APPROVED').length)}
        />
      </section>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          {/* No explicit text color here (was text-belize-navy, a fixed
              near-black): .bmpl-card already sets its own `color` from the
              theme token, light or glass -- an explicit override just
              fights it, which is exactly what made this heading and every
              role label below it read as near-invisible dark-on-dark once
              the card could be a dark glass surface. Inherit instead. */}
          <h2 className="text-lg font-bold">Your roles</h2>
          <Link href="/dashboard/roles" className="-my-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-[color:var(--bmpl-link)] hover:underline">
            Manage roles →
          </Link>
        </div>
        <ul className="divide-y divide-[color:var(--bmpl-border)]">
          {me.roles.map((role) => (
            <li key={role.roleCode} className="flex items-center justify-between py-3">
              <span className="font-medium">{role.label}</span>
              <StatusBadge status={role.status} />
            </li>
          ))}
        </ul>
      </Card>

      <ForYou className="mt-10" />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="bmpl-label">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}
