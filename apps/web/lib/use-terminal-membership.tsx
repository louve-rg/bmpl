'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, type ApiError } from './api';

/**
 * MDF-720: capped exponential backoff, then a steady slow retry forever
 * while mounted. Chosen over giving up after N attempts because a
 * dashboard session is long-lived -- a transient blip (a cold-compile dev
 * server, a brief network drop) should self-heal on its own the next time
 * the interval fires, with nobody needing to reload the page to see their
 * own workspace appear.
 */
const RETRY_DELAYS_MS = [1000, 3000, 9000, 30000];

/**
 * MDF-732: how long `status` must have been `loading` before the visible
 * loading affordance appears. `GET /terminal/me` answers 403 for the
 * overwhelming majority of customers, usually well inside this window -- so
 * most dashboard loads never show it at all, while a check that is
 * genuinely slow or stuck (MDF-720's original case: a cold-compile dev
 * server, a brief network drop) still surfaces it once the window elapses.
 * `status` itself is unaffected -- it is still `loading` the whole time;
 * this only gates when the UI treats that as worth interrupting the screen
 * for.
 */
const LOADING_GRACE_MS = 300;

export type TerminalMembershipStatus = 'loading' | 'member' | 'not-member' | 'error';

interface TerminalMembershipValue {
  status: TerminalMembershipStatus;
  /** See LOADING_GRACE_MS. */
  showLoading: boolean;
  retry: () => void;
}

const TerminalMembershipContext = createContext<TerminalMembershipValue | null>(null);

/**
 * MDF-732: `GET /terminal/me` used to run once per mounted consumer --
 * DashboardNavList (inside both Sidebar and MobileNavDrawer) and
 * TerminalWorkspaceBanner each held their own independent check, so every
 * dashboard load issued it twice (three times with the mobile drawer open),
 * with two independent capped-backoff retry loops on a failure. One
 * Provider mounted once in app/dashboard/layout.tsx now runs the single
 * check and every consumer below it reads the same result via
 * `useTerminalMembership()` -- same shape as before, just shared rather
 * than each consumer fetching its own copy.
 */
export function TerminalMembershipProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TerminalMembershipStatus>('loading');
  const [showLoading, setShowLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function check() {
      if (!cancelled) setStatus('loading');
      api
        .get('/terminal/me')
        .then(() => {
          if (!cancelled) setStatus('member');
        })
        .catch((e) => {
          if (cancelled) return;
          const errorStatus = (e as ApiError)?.status;
          if (errorStatus === 403) {
            setStatus('not-member'); // definitive: stop retrying
            return;
          }
          if (errorStatus === 401) {
            // MDF-733: api.ts already tried one silent refresh before a 401
            // reaches here, so the session is genuinely over -- send the
            // user to sign in, never retry, never claim the product broke.
            router.push(`/login?next=${encodeURIComponent(pathname)}`);
            return;
          }
          setStatus('error');
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
          attempt += 1;
          timer = setTimeout(check, delay);
        });
    }

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryToken, router, pathname]);

  // MDF-732: see LOADING_GRACE_MS. Re-armed every time `status` re-enters
  // 'loading' -- including a retry -- not just on the very first check.
  useEffect(() => {
    if (status !== 'loading') {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), LOADING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [status, retryToken]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  const value = useMemo<TerminalMembershipValue>(
    () => ({ status, showLoading, retry }),
    [status, showLoading, retry],
  );

  return <TerminalMembershipContext.Provider value={value}>{children}</TerminalMembershipContext.Provider>;
}

/**
 * Whether the signed-in user has an active terminal company membership —
 * independent of the 14 account role codes, since terminal staff are not
 * one of them (TERM-11). Reads the single check `TerminalMembershipProvider`
 * (mounted once in app/dashboard/layout.tsx) runs for the whole dashboard;
 * every consumer below it sees the same result rather than firing its own
 * `GET /terminal/me` (MDF-732).
 *
 * MDF-720: Jim's live run (`apps/web/e2e/mdf720-terminal-membership-
 * loading-state.local-only.spec.ts`) proved the original defect was a LOGIC
 * one, not a hung-request one -- a merely slow `GET /terminal/me` (not a
 * broken one) hid a real MANAGER's nav link for the whole delay with no
 * spinner anywhere, then the link correctly appeared once the fetch
 * resolved. A failed request hid it forever with no error shown anywhere,
 * ever. The root cause was collapsing every outcome into a single boolean
 * that only ever flips `true` on success: pending, failed and "not a
 * member" were all the identical, silent "false" to whoever was looking at
 * the screen.
 *
 * The fix returns which of FOUR distinct outcomes is current, so the nav
 * (DashboardNavList) can render something different for each:
 *  - `loading`: the first check is still in flight. `showLoading` gates
 *    when that becomes a visible affordance (MDF-732) -- `status` itself
 *    never skips this state.
 *  - `member`: the existing forced-visible override applies, unchanged.
 *  - `not-member`: a real 403 -- the common, definitive answer. Hide,
 *    exactly as before; this is the one case where hiding is correct.
 *  - `error`: anything else (network failure, timeout, a 5xx) is NEVER
 *    evidence of non-membership. Retries on a capped backoff in the
 *    background (self-heals a transient blip with no action needed) while
 *    also exposing `retry()` for a visible manual "try again" affordance,
 *    so the failure is never silent the way it used to be.
 *
 * MDF-733: a 401 is neither of those -- see the Provider above. It
 * redirects instead of exposing a fifth status; the four outcomes above
 * are an already-verified contract (loading/member/not-member/error, both
 * test-ids) that collapsing or extending would break for no benefit, since
 * the component is about to navigate away. A re-check (automatic backoff
 * retry OR a manual `retry()`) also re-enters `loading` before the request
 * goes out, so a "Try again" click that fails again is visibly in flight
 * rather than leaving the screen looking exactly as it did before the
 * click.
 *
 * Exists only so the nav can surface a workspace that is otherwise
 * reachable no other way; the terminal workspace page itself reads
 * `/terminal/me` again on its own terms and does not depend on this hook
 * for anything but visibility.
 */
export function useTerminalMembership(): TerminalMembershipValue {
  const ctx = useContext(TerminalMembershipContext);
  if (!ctx) {
    throw new Error(
      'useTerminalMembership() must be called under <TerminalMembershipProvider> ' +
        '(mounted once in app/dashboard/layout.tsx) -- a consumer rendered outside it ' +
        'would re-introduce the independent-fetch-per-consumer defect MDF-732 fixed.',
    );
  }
  return ctx;
}
