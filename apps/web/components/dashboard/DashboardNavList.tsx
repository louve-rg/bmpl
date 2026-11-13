'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { MeView } from '../../lib/types';
import { approvedRoles, visibleRoleGroupsWithOverrides } from '../../lib/dashboard-nav';
import { BASE_NAV, ROLE_GROUPS, allNavHrefs, isNavItemActive, type NavItem } from '../../lib/dashboard-nav-items';
import { badgeCount, unreadLabel } from '../../lib/badge';
import { useCarrierApplicationStatus } from '../../lib/use-carrier-application-status';
import { useSharedTerminalMembership } from '../../lib/terminal-membership-context';
import { navApplicationBadge } from '../../lib/shipping-provider';

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

  // MDF-526: a carrier's own pending application (ShippingProviderProfile at
  // any status) must be findable without a direct URL, even before the
  // SHIPPING_PROVIDER role is approved -- the two are independent lifecycles.
  // `carrierStatus` is null for everyone who never started one, so this is a
  // no-op for every other user.
  const carrierStatus = useCarrierApplicationStatus();
  const carrierRoleApproved = useMemo(() => approvedRoles(me.roles).has('SHIPPING_PROVIDER'), [me.roles]);
  const carrierForcedVisible = carrierStatus !== null && !carrierRoleApproved;

  // TERM-11: terminal company staff hold no account role code at all, so
  // "Terminal" can never earn its way into visibleRoleGroups through
  // `requires` (deliberately empty, see dashboard-nav-items.ts) — this
  // override is the ONLY way the group ever shows. Same unconditional-fetch
  // shape as useCarrierApplicationStatus above; independent of it otherwise.
  // MDF-720: `status` is one of four distinct outcomes (loading/member/
  // not-member/error), not a single boolean -- see the loading/error
  // affordances rendered below the nav groups.
  // TERM-NAV-COST: shared across every consumer on the page (nav + banner)
  // via TerminalMembershipProvider in the dashboard layout -- see that
  // file's own comment. Falls back to its own independent check if no
  // provider is mounted (every test for this component).
  const { status: terminalStatus, retry: retryTerminalMembership } = useSharedTerminalMembership();
  const terminalForcedVisible = terminalStatus === 'member';

  const forceVisible = useMemo(() => {
    const s = new Set<string>();
    if (carrierForcedVisible) s.add('Carrier');
    if (terminalForcedVisible) s.add('Terminal');
    return s;
  }, [carrierForcedVisible, terminalForcedVisible]);

  const groups: Array<{ heading?: string; items: NavItem[] }> = useMemo(
    () => [{ items: BASE_NAV }, ...visibleRoleGroupsWithOverrides(ROLE_GROUPS, me.roles, forceVisible)],
    [me.roles, forceVisible],
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
    // F-NAV: a terminal company member's ONLY route to their workspace is
    // this group -- collapsed-by-default (the same rule every other group
    // follows) left it undiscoverable below ~18 customer items unless the
    // visitor happened to already be on a page inside it. Membership is the
    // override, not the current page; a manual collapse (openOverrides,
    // checked above) still wins; opening something else back doesn't close
    // this one, same as any other group.
    if (group.heading === 'Terminal' && terminalForcedVisible) return true;
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
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{group.heading}</span>
                  {/* Legible-not-live: this group is visible only because an application
                      exists, not because the role was approved -- say so right on the
                      heading rather than let a pending applicant mistake this for a
                      working feature. */}
                  {group.heading === 'Carrier' && carrierForcedVisible && carrierStatus && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-amber-800">
                      {navApplicationBadge(carrierStatus)}
                    </span>
                  )}
                </span>
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
                        className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-belize-accent px-1.5 text-[10px] font-bold leading-[18px] text-belize-navy"
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

      {/* MDF-720: while membership is still unresolved or failed to
          resolve, this must never look identical to "not a member" --
          that silent collapse is the exact defect Jim's live run proved.
          Rendered outside the groups loop since there is no "Terminal"
          group to attach a heading badge to until membership is actually
          confirmed. Nothing renders once `terminalStatus` settles to
          'member' or 'not-member'. */}
      {terminalStatus === 'loading' && (
        <p data-testid="terminal-membership-loading" className="px-3 py-1.5 text-xs text-[color:var(--bmpl-text-muted)]">
          Loading terminal access…
        </p>
      )}
      {terminalStatus === 'error' && (
        <div data-testid="terminal-membership-error" className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-amber-800">
          <span>Something went wrong checking your terminal access.</span>
          <button type="button" onClick={retryTerminalMembership} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}
    </nav>
  );
}
