'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

export type TerminalMembershipStatus = 'loading' | 'member' | 'not-member' | 'error';

/**
 * Whether the signed-in user has an active terminal company membership —
 * independent of the 14 account role codes, since terminal staff are not
 * one of them (TERM-11). Mirrors useCarrierApplicationStatus exactly:
 * fired unconditionally for every signed-in user, same as
 * `useUnreadMessages` — `GET /terminal/me` answers 403 for the overwhelming
 * majority who are not terminal staff.
 *
 * MDF-720: Jim's live run (`apps/web/e2e/mdf720-terminal-membership-
 * loading-state.local-only.spec.ts`) proved this is a LOGIC defect, not a
 * hung-request one -- a merely slow `GET /terminal/me` (not a broken one)
 * hid a real MANAGER's nav link for the whole delay with no spinner
 * anywhere, then the link correctly appeared once the fetch resolved. A
 * failed request hid it forever with no error shown anywhere, ever. The
 * root cause was collapsing every outcome into a single boolean that only
 * ever flips `true` on success: pending, failed and "not a member" were
 * all the identical, silent "false" to whoever was looking at the screen.
 *
 * The fix returns which of FOUR distinct outcomes is current, so the nav
 * (DashboardNavList) can render something different for each:
 *  - `loading`: the first check is still in flight. Render a visible
 *    loading affordance, never the same blank state a non-member sees.
 *  - `member`: the existing forced-visible override applies, unchanged.
 *  - `not-member`: a real 403 -- the common, definitive answer. Hide,
 *    exactly as before; this is the one case where hiding is correct.
 *  - `error`: anything else (network failure, timeout, a 5xx) is NEVER
 *    evidence of non-membership. Retries on a capped backoff in the
 *    background (self-heals a transient blip with no action needed) while
 *    also exposing `retry()` for a visible manual "try again" affordance,
 *    so the failure is never silent the way it used to be.
 *
 * TERM-NAV-401 (Stanley's read of F-NAV): a 401 reaching here is NOT a
 * transient blip the way a network error or 5xx is -- `api.get` already
 * attempted one silent token refresh before this hook ever sees the
 * rejection (see `request()` in lib/api.ts), so a 401 here means the
 * session is genuinely gone. Lumping it into `error` told the user their
 * session merely ending was the PRODUCT being broken, and "Try again" can
 * never fix an expired session -- it would just retry forever on the same
 * backoff. So a 401 redirects to sign-in instead, the same convention every
 * other dashboard data fetch in this app already uses on its own 401 (e.g.
 * `app/wallet/page.tsx`, `app/dashboard/incoming/page.tsx`), and schedules
 * no retry. `status` is left at `loading` rather than switched to `error`
 * for the brief moment before navigation completes -- not a fifth state,
 * just which of the existing four is least wrong to show while leaving.
 *
 * Also fixed here: `check()` now sets `loading` at the START of every
 * attempt, not just the first. Before this, a re-check (the backoff timer
 * or a manual `retry()`) that failed again re-set status to the SAME
 * `error` value it already held -- React skips the re-render, so nothing
 * on screen changed and a working retry looked identical to a dead one.
 *
 * Exists only so the nav can surface a workspace that is otherwise
 * reachable no other way; the terminal workspace page itself reads
 * `/terminal/me` again on its own terms and does not depend on this hook
 * for anything but visibility.
 *
 * TERM-NAV-COST: this ran once per `DashboardNavList` instance (Sidebar's
 * desktop copy AND MobileNavDrawer's mobile copy are BOTH mounted at once,
 * CSS hides one per breakpoint, neither ever unmounts) plus once more for
 * `TerminalWorkspaceBanner` on `/dashboard` -- up to three independent
 * fetches and three independent retry loops for the identical fact about
 * the identical signed-in user on one page load. `enabled` lets
 * `terminal-membership-context.tsx`'s `useSharedTerminalMembership` call
 * this hook UNCONDITIONALLY (rules of hooks) from every consumer while
 * only the single instance inside `TerminalMembershipProvider` actually
 * runs the effect -- every other consumer reads that one result over
 * context instead. Defaults to `true` so every existing standalone caller
 * (and every existing test, none of which wrap in that provider) keeps the
 * exact behaviour it already had.
 */
export function useTerminalMembership(enabled = true): { status: TerminalMembershipStatus; retry: () => void } {
  const [status, setStatus] = useState<TerminalMembershipStatus>('loading');
  const [retryToken, setRetryToken] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
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
          const httpStatus = (e as ApiError)?.status;
          if (httpStatus === 403) {
            setStatus('not-member'); // definitive: stop retrying
            return;
          }
          if (httpStatus === 401) {
            // Session is genuinely gone, not a blip -- see the header
            // comment. No retry timer; `window.location` (not the closed-
            // over `usePathname`) so the `next` param is never stale if the
            // visitor navigated within the dashboard between mount and now.
            const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/dashboard';
            router.push(`/login?next=${encodeURIComponent(next)}`);
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
  }, [retryToken, router, enabled]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  return { status, retry };
}
