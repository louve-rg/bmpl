'use client';

import { useCallback, useEffect, useState } from 'react';
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
 * MDF-733: a 401 is neither of those. `api.get` (lib/api.ts) already tries
 * one silent token refresh before a 401 ever reaches this `.catch` -- so a
 * 401 here means the refresh itself failed and the session is genuinely
 * over, the same condition every other page's own `status === 401` check
 * sends to `/login?next=...` for (see app/cart/page.tsx, app/wallet/page.tsx
 * and others). Treating it as `error` and retrying on the backoff is wrong
 * twice over: it can never succeed (an expired session does not heal
 * itself), and it tells the user the PRODUCT is broken ("Something went
 * wrong") when in fact their SESSION ended, which is normal and expected.
 * This hook redirects instead of exposing a fifth status -- the four
 * outcomes above are an already-verified contract (loading/member/
 * not-member/error, both test-ids) that collapsing or extending would
 * break for no benefit, since the component is about to navigate away.
 *
 * Also MDF-733: a re-check (automatic backoff retry OR a manual `retry()`)
 * now re-enters `loading` before the request goes out, not just on the
 * very first check. Previously `status` only ever left `error` on success,
 * so a "Try again" click that failed again re-issued the request but the
 * screen never visibly changed -- indistinguishable from the button doing
 * nothing at all.
 *
 * Exists only so the nav can surface a workspace that is otherwise
 * reachable no other way; the terminal workspace page itself reads
 * `/terminal/me` again on its own terms and does not depend on this hook
 * for anything but visibility.
 */
export function useTerminalMembership(): { status: TerminalMembershipStatus; retry: () => void } {
  const [status, setStatus] = useState<TerminalMembershipStatus>('loading');
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
            // Session genuinely expired (api.ts already tried one silent
            // refresh) -- send the user to sign in, never retry, never
            // claim the product is broken.
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

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  return { status, retry };
}
