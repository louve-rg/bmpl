import Link from 'next/link';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../../lib/server-api';
import { StatusBadge } from '../../../components/StatusBadge';

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
  const items = res.ok ? res.data : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-belize-navy">Role Applications</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/dashboard/applications" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">
            All open
          </Link>
          <Link
            href="/dashboard/applications?status=PENDING"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5"
          >
            Pending
          </Link>
          <Link
            href="/dashboard/applications?status=MORE_INFO_REQUIRED"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5"
          >
            More info
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No applications in this queue. 🎉
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Docs</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
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
