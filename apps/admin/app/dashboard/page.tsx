import Link from 'next/link';
import { serverGet } from '../../lib/server-api';
import { Card, PageHeader } from '../../components/ui';
import { AccessNotice } from '../../components/AccessNotice';
import { adminCrumbs } from '../../lib/admin-nav';

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

  // A refused admin must never read "Total users 0" as a fact — a zeroed
  // card is a wrong answer stated confidently, worse than no answer
  // (BMPL-144). Say why instead.
  if (!res.ok) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs('Overview')} eyebrow="Admin" title="Overview" description="A quick snapshot of platform activity that needs attention." />
        <AccessNotice message={res.message} />
      </div>
    );
  }
  const s = res.data;

  const cards = [
    { label: 'Total users', value: s?.totalUsers ?? 0, href: '/dashboard/users' },
    { label: 'Pending applications', value: s?.pendingApplications ?? 0, href: '/dashboard/applications' },
    { label: 'Awaiting more info', value: s?.moreInfoApplications ?? 0, href: '/dashboard/applications?status=MORE_INFO_REQUIRED' },
    { label: 'Suspended users', value: s?.suspendedUsers ?? 0, href: '/dashboard/users?status=SUSPENDED' },
    { label: 'Suspended roles', value: s?.suspendedRoles ?? 0, href: '/dashboard/users' },
  ];

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Overview')} eyebrow="Admin" title="Overview" description="A quick snapshot of platform activity that needs attention." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="block">
            {/* No hardcoded text-belize-navy/text-slate-500 -- same bug as
                apps/web's dashboard home page: .bmpl-card already sets its
                own theme-aware `color`, and an explicit override just
                fights it (confirmed on a real logged-in screenshot: these
                numbers were near-invisible dark-on-dark on the glass
                console). bmpl-label is already token-aware. */}
            <Card className="p-5 transition hover:border-belize-light hover:shadow-bmpl-md">
              <p className="bmpl-label">{c.label}</p>
              <p className="mt-1.5 text-3xl font-bold">{c.value}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
