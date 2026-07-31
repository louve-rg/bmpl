import { serverGet } from '../../../lib/server-api';
import { EmptyState, PageHeader } from '../../../components/ui';

export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  action: string;
  reason: string | null;
  targetRole: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { firstName: string; lastName: string; email: string } | null;
  targetUser: { firstName: string; lastName: string; email: string } | null;
}
interface AuditResult {
  total: number;
  items: AuditRow[];
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { targetUserId?: string };
}) {
  const q = searchParams.targetUserId ? `?targetUserId=${searchParams.targetUserId}` : '';
  const res = await serverGet<AuditResult>(`/admin/audit${q}`);
  const items = res.ok ? res.data.items : [];

  return (
    <div>
      <PageHeader eyebrow="Governance" title="Audit Log" />
      {items.length === 0 ? (
        <EmptyState title="No audit entries yet" description="Administrative actions across the platform will be recorded here." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-belize-navy">
                    {row.action.replace(/_/g, ' ')}
                    {row.targetRole && <span className="ml-1 text-xs text-slate-500">({row.targetRole})</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : 'System'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.targetUser ? row.targetUser.email : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {row.reason ?? ''}
                    {row.ipAddress && <span className="ml-1 text-slate-400">· {row.ipAddress}</span>}
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
