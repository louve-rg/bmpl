import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../../../lib/server-api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { AccountActions, RoleActions } from './RoleActions';

export const dynamic = 'force-dynamic';

interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  district: string | null;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  roles: Array<{ roleCode: RoleCode; status: string; statusReason: string | null }>;
  adminPermissions: Array<{ permission: string }>;
}

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const res = await serverGet<UserDetail>(`/admin/users/${params.id}`);
  if (!res.ok) notFound();
  const u = res.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard/users" className="text-sm text-belize-blue hover:underline">
        ← Back to users
      </Link>

      <header className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-belize-navy">
            {u.firstName} {u.lastName}
          </h1>
          <p className="text-sm text-slate-500">
            {u.email} {u.emailVerifiedAt ? '· ✓ verified' : '· unverified'}
          </p>
          <p className="text-xs text-slate-500">
            {u.district ?? '—'} · joined {new Date(u.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={u.status} />
          <AccountActions userId={u.id} status={u.status} />
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">Roles</h2>
        <ul className="divide-y divide-slate-100">
          {u.roles.map((r) => (
            <li key={r.roleCode} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium text-belize-navy">{ROLE_DEFINITIONS[r.roleCode].label}</p>
                {r.statusReason && <p className="text-xs text-slate-500">{r.statusReason}</p>}
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} />
                <RoleActions userId={u.id} roleCode={r.roleCode} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Admin permissions</h2>
          <Link
            href={`/dashboard/audit?targetUserId=${u.id}`}
            className="text-sm font-semibold text-belize-blue hover:underline"
          >
            View history →
          </Link>
        </div>
        {u.adminPermissions.length === 0 ? (
          <p className="text-sm text-slate-400">No administrative permissions.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {u.adminPermissions.map((p) => (
              <span
                key={p.permission}
                className="rounded-full bg-belize-blue/10 px-2.5 py-0.5 text-xs font-medium text-belize-blue"
              >
                {p.permission}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
