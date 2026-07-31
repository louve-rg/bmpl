import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../../../lib/server-api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Badge, Card } from '../../../../components/ui';
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
      <Link href="/dashboard/users" className="text-sm font-medium text-belize-blue hover:underline">
        ← Back to users
      </Link>

      <header className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="bmpl-page-title">
            {u.firstName} {u.lastName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
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

      <Card className="mb-5 p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</h2>
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
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin permissions</h2>
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
              <Badge key={p.permission} tone="brand">
                {p.permission}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
