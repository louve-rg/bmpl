'use client';

import Link from 'next/link';
import { BrandLockup } from '../Logo';
import { Avatar } from '../Avatar';
import { RoleSwitcher } from './RoleSwitcher';
import { LogoutButton } from './LogoutButton';
import { DashboardNavList } from './DashboardNavList';
import type { MeView } from '../../lib/types';
import { useUnreadMessages } from '../../lib/use-unread-messages';

/**
 * The DESKTOP dashboard sidebar.
 *
 * Hidden below `md` entirely. It previously rendered as a full-width block at the
 * top of every phone screen with the whole multi-group nav collapsed behind an
 * inline toggle — so a driver's actual work was pushed below a nav bar, and
 * opening the menu pushed it off-screen instead of overlaying it. On phones the
 * navigation is now a drawer (see MobileNavDrawer) and the page gets the viewport.
 */
export function Sidebar({ me }: { me: MeView }) {
  const unread = useUnreadMessages();

  return (
    <aside className="hidden border-r border-slate-200 bg-white md:block md:h-screen md:w-72 md:shrink-0 md:overflow-y-auto">
      <div className="flex h-full flex-col gap-6 p-5">
        <Link href="/" className="block rounded-bmpl-lg bg-belize-navy p-3">
          <BrandLockup />
        </Link>

        <RoleSwitcher me={me} />

        <DashboardNavList me={me} unread={unread} />

        <div className="mt-auto border-t border-slate-100 pt-4">
          <Link
            href="/dashboard/profile"
            className="mb-2 flex items-center gap-3 rounded-bmpl-md px-3 py-1.5 transition hover:bg-slate-50"
          >
            <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-belize-navy">
                {me.firstName} {me.lastName}
              </span>
              <span className="block truncate text-xs text-slate-500">{me.email}</span>
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
