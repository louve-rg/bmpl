import Link from 'next/link';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../lib/server-api';
import type { MeView } from '../../lib/types';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  MORE_INFO_REQUIRED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  REVOKED: 'bg-slate-200 text-slate-700',
};

export default async function DashboardHome() {
  const me = (await serverGet<MeView>('/me'))!;
  const activeLabel = me.activeRole ? ROLE_DEFINITIONS[me.activeRole as RoleCode].label : 'Customer';

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <p className="text-sm text-slate-500">Signed in as {activeLabel}</p>
        <h1 className="text-2xl font-bold text-belize-navy">Welcome, {me.firstName} 👋</h1>
      </header>

      {!me.emailVerified && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Please verify your email to unlock provider features. Check your inbox for the link.
        </div>
      )}

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active role" value={activeLabel} />
        <StatCard label="Roles held" value={String(me.roles.length)} />
        <StatCard
          label="Approved roles"
          value={String(me.roles.filter((r) => r.status === 'APPROVED').length)}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
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
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  STATUS_STYLES[role.status] ?? 'bg-slate-100 text-slate-600'
                }`}
              >
                {role.status.replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-belize-navy">{value}</p>
    </div>
  );
}
