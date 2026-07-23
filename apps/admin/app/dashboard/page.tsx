import Link from 'next/link';
import { serverGet } from '../../lib/server-api';

export const dynamic = 'force-dynamic';

interface Summary {
  totalUsers: number;
  pendingApplications: number;
  moreInfoApplications: number;
  suspendedUsers: number;
  suspendedRoles: number;
}

export default async function AdminDashboard() {
  const res = await serverGet<Summary>('/admin/summary');
  const s = res.ok ? res.data : null;

  const cards = [
    { label: 'Total users', value: s?.totalUsers ?? 0, href: '/dashboard/users' },
    { label: 'Pending applications', value: s?.pendingApplications ?? 0, href: '/dashboard/applications' },
    { label: 'Awaiting more info', value: s?.moreInfoApplications ?? 0, href: '/dashboard/applications?status=MORE_INFO_REQUIRED' },
    { label: 'Suspended users', value: s?.suspendedUsers ?? 0, href: '/dashboard/users?status=SUSPENDED' },
    { label: 'Suspended roles', value: s?.suspendedRoles ?? 0, href: '/dashboard/users' },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-belize-navy">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-belize-light hover:shadow"
          >
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className="mt-1 text-3xl font-bold text-belize-navy">{c.value}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
