'use client';

import Link from 'next/link';
import { BrandLockup } from '../Logo';
import { RoleSwitcher } from './RoleSwitcher';
import { DashboardNavList } from './DashboardNavList';
import type { MeView } from '../../lib/types';
import { useUnreadMessages } from '../../lib/use-unread-messages';
import { AccountMenu } from '../account/AccountMenu';

/**
 * The DESKTOP dashboard sidebar.
 *
 * Hidden below `md` entirely. It previously rendered as a full-width block at the
 * top of every phone screen with the whole multi-group nav collapsed behind an
 * inline toggle — so a driver's actual work was pushed below a nav bar, and
 * opening the menu pushed it off-screen instead of overlaying it. On phones the
 * navigation is now a drawer (see MobileNavDrawer) and the page gets the viewport.
 *
 * Layout fix for MDF-319 (desktop twin of the mobile logout defect): this used
 * to be one `overflow-y-auto` region with the account menu as the last child
 * (`mt-auto`), so a nav list taller than the viewport pushed the account
 * trigger down with it — measured in production never fitting at any height
 * from 600 to 1300px for an account with enough roles. A mouse user had no
 * way to discover it (the sidebar's own scrollbar gives no visible hint
 * there's more below the fold); a keyboard user was fine, since Tab scrolls
 * the focused element into view natively. Now: the brand/role-switcher header
 * and the account footer are OUTSIDE the scrolling region (`shrink-0`), and
 * only the nav list itself (`flex-1 overflow-y-auto`) scrolls — so the
 * account trigger's position is fixed relative to the viewport regardless of
 * how many nav rows render above it, for any number of roles.
 */
export function Sidebar({ me }: { me: MeView }) {
  const unread = useUnreadMessages();

  return (
    <aside className="glass-chrome hidden md:flex md:h-screen md:w-72 md:shrink-0 md:flex-col">
      <div className="flex shrink-0 flex-col gap-6 p-5 pb-0">
        <Link href="/" className="block rounded-bmpl-lg bg-belize-navy p-3">
          <BrandLockup />
        </Link>

        <RoleSwitcher me={me} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <DashboardNavList me={me} unread={unread} />
      </div>

      <div className="bmpl-nav-footer shrink-0 p-5 pt-4">
        <AccountMenu me={me} tone="glass" />
      </div>
    </aside>
  );
}
