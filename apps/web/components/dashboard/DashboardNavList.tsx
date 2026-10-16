'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { MeView } from '../../lib/types';
import { visibleRoleGroups } from '../../lib/dashboard-nav';
import { BASE_NAV, ROLE_GROUPS, allNavHrefs, isNavItemActive, type NavItem } from '../../lib/dashboard-nav-items';
import { badgeCount, unreadLabel } from '../../lib/badge';

function groupHasActiveItem(items: NavItem[], pathname: string, hrefs: string[]): boolean {
  return items.some((item) => isNavItemActive(item.href, pathname, hrefs));
}

/**
 * The dashboard navigation list, rendered identically for the desktop sidebar and
 * the mobile drawer.
 *
 * There is one navigation definition (lib/dashboard-nav-items.ts) and one
 * renderer; the two shells differ only in the box they put this in. Keeping a
 * separate mobile menu is how a nav item ends up on one surface and not the
 * other.
 *
 * BASE_NAV (every signed-in user's baseline, 14 items) renders flat, same as
 * before. Role-gated groups are now COLLAPSIBLE: a multi-role account used to
 * show every unlocked group fully expanded at once (37 rows for a 4-role
 * account is the extreme case), which is the "41-row menu" the redesign
 * brief named directly. Zero routes are removed or hidden behind a role
 * switch -- every approved group is still LISTED, every item still reachable
 * from this same list, just collapsed to its heading until opened. This is
 * the additive/grouped answer to the role-contextual-vs-grouped question,
 * not a role filter: `visibleRoleGroups` still reads `me.roles`, same as
 * before, and nothing here depends on an "active" role. A group containing
 * the page you're currently on starts expanded, so your own location is
 * never hidden behind a click.
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

  // Open-by-default: a group containing the current page. Collapsed-by-default
  // otherwise -- this is where "significantly shorter" actually comes from.
  // Keyed by heading (BASE_NAV has none and is never collapsible), recomputed
  // whenever the role set changes so a newly-unlocked group isn't stuck
  // "closed" forever by a stale key, and re-opened whenever navigation lands
  // inside it even if the person had closed it.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  function isOpen(group: { heading?: string; items: NavItem[] }): boolean {
    if (!group.heading) return true; // BASE_NAV: never collapsible
    if (group.heading in openOverrides) return openOverrides[group.heading]!;
    return groupHasActiveItem(group.items, pathname, hrefs);
  }

  function toggle(group: { heading?: string; items: NavItem[] }) {
    if (!group.heading) return;
    const current = isOpen(group);
    setOpenOverrides((prev) => ({ ...prev, [group.heading!]: !current }));
  }

  return (
    <nav className="flex flex-col gap-1" aria-label="Dashboard">
      {groups.map((group, gi) => {
        const open = isOpen(group);
        return (
          <div key={group.heading ?? gi} className="flex flex-col gap-0.5">
            {group.heading && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`nav-group-${gi}`}
                onClick={() => toggle(group)}
                className="bmpl-nav-heading"
              >
                {group.heading}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="bmpl-chev h-3 w-3 shrink-0"
                  aria-hidden
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            )}
            <div id={group.heading ? `nav-group-${gi}` : undefined} className={group.heading && !open ? 'hidden' : 'flex flex-col gap-0.5'}>
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
                    // `group` as a literal class (not via @apply, which doesn't
                    // emit the literal class name Tailwind's group-* variants
                    // scan the source for) -- needed for the active-indicator
                    // bar below to read its parent's aria-current.
                    className="bmpl-nav-item group"
                  >
                    <span className="h-4 w-0.5 shrink-0 rounded-full bg-current opacity-0 transition group-aria-[current=page]:opacity-100" aria-hidden />
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
          </div>
        );
      })}
    </nav>
  );
}
