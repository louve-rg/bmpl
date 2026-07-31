import Link from 'next/link';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../lib/server-api';
import type { MeView } from '../../lib/types';
import { Alert, Card, PageHeader, StatusBadge } from '../../components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  const me = (await serverGet<MeView>('/me'))!;
  const activeLabel = me.activeRole ? ROLE_DEFINITIONS[me.activeRole as RoleCode].label : 'Customer';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={`Signed in as ${activeLabel}`} title={`Welcome, ${me.firstName}`} />

      {!me.emailVerified && (
        <Alert tone="warning" className="mb-6">
          Please verify your email to unlock provider features. Check your inbox for the link.
        </Alert>
      )}

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
          <h2 className="text-lg font-bold text-belize-navy">Your roles</h2>
          <Link href="/dashboard/roles" className="text-sm font-semibold text-belize-blue hover:underline">
            Manage roles →
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {me.roles.map((role) => (
            <li key={role.roleCode} className="flex items-center justify-between py-3">
              <span className="font-medium text-belize-navy">{role.label}</span>
              <StatusBadge status={role.status} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="bmpl-label">{label}</p>
      <p className="mt-1 text-2xl font-bold text-belize-navy">{value}</p>
    </Card>
  );
}
