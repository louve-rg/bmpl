'use client';

import Link from 'next/link';
import { Alert } from '../ui';
import { useSharedTerminalMembership } from '../../lib/terminal-membership-context';

/**
 * F-NAV: Stanley drove the real product as a real invited Terminal Manager
 * and landed on the ordinary customer dashboard -- "Signed in as Customer,
 * Welcome, Stanley" -- with the only route to the workspace a collapsed
 * "Terminal" group at the bottom of roughly 18 customer nav items, below the
 * fold at 1280x900. The owner's own framing: a client told to open their
 * Terminal Workspace who instead has to scroll past an unrelated shop
 * dashboard and expand a collapsed group has been handed a bad product,
 * independent of whether the code underneath is correct.
 *
 * This is deliberately NOT the same fetch as MDF-720's nav-level loading/
 * error affordances: MDF-720 is about the link vanishing on a delay or
 * error; this is about the link being undiscoverable when everything
 * already works. So this renders ONLY on a confirmed 'member' -- nothing
 * for loading, error or not-member, to avoid duplicating the nav's own
 * affordances for those states on every dashboard page load.
 */
export function TerminalWorkspaceBanner() {
  // TERM-NAV-COST: shared with the nav via TerminalMembershipProvider --
  // see terminal-membership-context.tsx.
  const { status } = useSharedTerminalMembership();
  if (status !== 'member') return null;

  return (
    <Alert tone="brand" className="mb-6">
      <Link href="/dashboard/terminal" className="flex items-center justify-between gap-3 font-semibold hover:underline">
        <span>You have a Terminal Workspace waiting — open it to see what needs you.</span>
        <span aria-hidden className="shrink-0">
          Open →
        </span>
      </Link>
    </Alert>
  );
}
