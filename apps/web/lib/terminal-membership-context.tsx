'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTerminalMembership, type TerminalMembershipStatus } from './use-terminal-membership';

type TerminalMembershipValue = { status: TerminalMembershipStatus; retry: () => void };

const TerminalMembershipContext = createContext<TerminalMembershipValue | null>(null);

/**
 * TERM-NAV-COST: makes the ONE real `/terminal/me` check for everything
 * below it. Mounted once, in the dashboard layout, above both the nav
 * (Sidebar + MobileNavDrawer, both always mounted) and any page-level
 * consumer (TerminalWorkspaceBanner on `/dashboard`) -- see
 * `use-terminal-membership.ts`'s own header comment for the full "up to
 * three independent fetches" account of what this replaces.
 */
export function TerminalMembershipProvider({ children }: { children: ReactNode }) {
  const value = useTerminalMembership();
  return <TerminalMembershipContext.Provider value={value}>{children}</TerminalMembershipContext.Provider>;
}

/**
 * What every consumer (DashboardNavList, TerminalWorkspaceBanner) calls
 * instead of `useTerminalMembership` directly. Reads the shared result when
 * a `TerminalMembershipProvider` is mounted above (true in production,
 * always). Falls back to an independent, fully self-sufficient check when
 * there isn't one, so every existing test for either consumer -- none of
 * which wrap in this provider -- keeps working completely unchanged.
 * `useTerminalMembership(ctx === null)` is called UNCONDITIONALLY, same
 * component, same hook, every render (rules of hooks); its own `enabled`
 * flag is what skips the network effect entirely once a provider is
 * already supplying the answer, so there is never a second fetch in
 * production despite this unconditional call.
 */
export function useSharedTerminalMembership(): TerminalMembershipValue {
  const ctx = useContext(TerminalMembershipContext);
  const standalone = useTerminalMembership(ctx === null);
  return ctx ?? standalone;
}
