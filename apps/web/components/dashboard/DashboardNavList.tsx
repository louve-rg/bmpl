'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import type { MeView } from '../../lib/types';
import { visibleRoleGroups } from '../../lib/dashboard-nav';
import { BASE_NAV, ROLE_GROUPS, allNavHrefs, isNavItemActive, type NavItem } from '../../lib/dashboard-nav-items';
import { badgeCount, unreadLabel } from '../../lib/badge';

/**
 * The dashboard navigation list, rendered identically for the desktop sidebar and
 * the mobile drawer.
 *
 * There is one navigation definition (lib/dashboard-nav-items.ts) and one
 * renderer; the two shells differ only in the box they put this in. Keeping a
 * separate mobile menu is how a nav item ends up on one surface and not the
 * other.
 */
export function DashboardNavList({
  me,
  unread,
  onNavigate,
}: {
  me: MeView;
  /** Unread message count for the Messages badge. */
  unread: number;
  /** Called after a destination is chosen — the drawer uses it to close. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups: Array<{ heading?: string; items: NavItem[] }> = useMemo(
    () => [{ items: BASE_NAV }, ...visibleRoleGroups(ROLE_GROUPS, me.roles)],
    [me.roles],
  );
  const hrefs = useMemo(() => allNavHrefs(groups), [groups]);

  return (
    <nav className="flex flex-col gap-4" aria-label="Dashboard">
      {groups.map((group, gi) => (
        <div key={group.heading ?? gi} className="flex flex-col gap-0.5">
          {group.heading && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {group.heading}
            </p>
          )}
          {group.items.map((item) => {
            const active = isNavItemActive(item.href, pathname, hrefs);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                // min-h-[44px]: these are tapped one-handed on a phone, and the
                // previous 36px rows were below the comfortable touch target.
                className={`group flex min-h-[44px] items-center gap-3 rounded-bmpl-md px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-belize-blue/10 text-belize-blue' : 'text-slate-600 hover:bg-slate-50 hover:text-belize-navy'
                }`}
              >
                <span className={`h-4 w-0.5 shrink-0 rounded-full transition ${active ? 'bg-belize-blue' : 'bg-transparent'}`} aria-hidden />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 shrink-0"
                  aria-hidden
                >
                  <path d={item.icon} />
                </svg>
                {/* Long labels ("Application & Documents") wrap rather than
                    pushing the drawer wider than the viewport. */}
                <span className="min-w-0 flex-1 break-words">{item.label}</span>
                {item.href === '/dashboard/messages' && unread > 0 && (
                  <span
                    aria-label={unreadLabel(unread)}
                    className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-belize-accent px-1.5 text-[10px] font-bold leading-[18px] text-white"
                  >
                    {badgeCount(unread)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
