import Link from 'next/link';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../../lib/server-api';
import { StatusBadge } from '../../../components/StatusBadge';
import { EmptyState, PageHeader } from '../../../components/ui';
import { AccessNotice } from '../../../components/AccessNotice';
import { adminCrumbs } from '../../../lib/admin-nav';

export const dynamic = 'force-dynamic';

interface QueueItem {
  id: string;
  roleCode: RoleCode;
  status: string;
  submittedAt: string;
  message: string | null;
  user: { id: string; email: string; firstName: string; lastName: string };
  documents: Array<{ id: string; label: string | null }>;
}

export default async function ApplicationsQueue({
  searchParams,
}: {
  searchParams: { status?: 'PENDING' | 'MORE_INFO_REQUIRED' };
}) {
  const query = searchParams.status ? `?status=${searchParams.status}` : '';
  const res = await serverGet<QueueItem[]>(`/admin/applications${query}`);
  // Refused is not the same as empty: "no applications" to a refused admin
  // is a lie of omission (BMPL-144).
  if (!res.ok) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs('Role Applications')} eyebrow="Onboarding" title="Role Applications" />
        <AccessNotice message={res.message} />
      </div>
    );
  }
  const items = res.data;

  const filters: Array<{ label: string; href: string; active: boolean }> = [
    { label: 'All open', href: '/dashboard/applications', active: !searchParams.status },
    { label: 'Pending', href: '/dashboard/applications?status=PENDING', active: searchParams.status === 'PENDING' },
    {
      label: 'More info',
      href: '/dashboard/applications?status=MORE_INFO_REQUIRED',
      active: searchParams.status === 'MORE_INFO_REQUIRED',
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Role Applications')}
        eyebrow="Onboarding"
        title="Role Applications"
        actions={
          <div className="flex flex-wrap gap-2 text-sm">
            {filters.map((f) => (
              <Link
                key={f.label}
                href={f.href}
                className={`rounded-bmpl-md border px-3 py-1.5 font-medium transition ${
                  f.active
                    ? 'border-belize-blue bg-belize-blue/5 text-belize-blue'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="No applications in this queue" description="New role applications will appear here for review." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Docs</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">
                      {item.user.firstName} {item.user.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{item.user.email}</p>
                  </td>
                  <td className="px-4 py-3">{ROLE_DEFINITIONS[item.roleCode].label}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3">{item.documents.length}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/applications/${item.id}`}
                      className="font-semibold text-belize-blue hover:underline"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
