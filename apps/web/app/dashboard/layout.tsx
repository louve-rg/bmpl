import { redirect } from 'next/navigation';
import { serverGet } from '../../lib/server-api';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import type { MeView } from '../../lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeView>('/me');
  if (!me) redirect('/login');

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <Sidebar me={me} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-slate-200 bg-white px-5 py-2.5 md:px-8">
          <NotificationBell />
        </header>
        <div className="flex-1 p-5 md:p-8">{children}</div>
      </main>
    </div>
  );
}
