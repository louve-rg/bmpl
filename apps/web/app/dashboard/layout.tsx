import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverGet } from '../../lib/server-api';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { MobileNavDrawer } from '../../components/dashboard/MobileNavDrawer';
import { AvatarRequiredBanner } from '../../components/dashboard/AvatarRequiredBanner';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { BrandLockup } from '../../components/Logo';
import { Avatar } from '../../components/Avatar';
import type { MeView } from '../../lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeView>('/me');
  if (!me) redirect('/login');

  return (
    // min-w-0 on the flex child + overflow-x-hidden here: a single wide table or
    // long address inside a page must not make the whole dashboard scroll
    // sideways on a phone.
    <div className="min-h-screen overflow-x-hidden bg-slate-50 md:flex">
      <Sidebar me={me} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:justify-end md:px-8 md:py-2.5"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
        >
          {/* Phone/tablet: hamburger + brand. Both are hidden from `md` up, where
              the sidebar carries the brand and the navigation. */}
          <MobileNavDrawer me={me} />
          <Link href="/" className="rounded-bmpl-md bg-belize-navy px-2 py-1.5 md:hidden">
            <BrandLockup />
          </Link>
          <div className="ml-auto flex items-center gap-1 md:gap-3">
            {/* Approved roles only: a pending driver application should not make
                delivery notifications open the driver job screen. */}
            <NotificationBell
              roleCodes={me.roles.filter((r) => r.status === 'APPROVED').map((r) => r.roleCode)}
            />
            <Link
              href="/dashboard/profile"
              aria-label="Your profile"
              className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
            >
              <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} size="sm" />
            </Link>
          </div>
        </header>
        <AvatarRequiredBanner me={me} />
        <div className="min-w-0 flex-1 p-4 sm:p-5 md:p-8">{children}</div>
      </main>
    </div>
  );
}
