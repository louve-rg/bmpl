import { redirect } from 'next/navigation';
import { serverGet } from '../../lib/server-api';
import { AdminShell } from '../../components/AdminShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Confirm the caller actually has an admin permission before rendering.
  const res = await serverGet('/admin/summary');
  if (!res.ok) redirect('/login');
  return <AdminShell>{children}</AdminShell>;
}
