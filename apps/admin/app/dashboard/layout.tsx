import { redirect } from 'next/navigation';
import { serverGet } from '../../lib/server-api';
import { canEnterConsole, type MeForAccess } from '../../lib/admin-access';
import { AdminShell } from '../../components/AdminShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Same identity rule as the login screen (BMPL-143): an APPROVED ADMIN
  // role plus at least one admin permission enters; each screen refuses
  // individually. The old probe of /admin/summary required users.read and
  // bounced every scoped admin straight back to /login.
  const res = await serverGet<MeForAccess>('/me');
  if (!res.ok || !canEnterConsole(res.data)) redirect('/login');
  return <AdminShell>{children}</AdminShell>;
}
