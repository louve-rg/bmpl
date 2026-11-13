'use client';

import { useEffect, useState } from 'react';
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
 * Whether the signed-in user has an active terminal company membership —
 * independent of the 14 account role codes, since terminal staff are not
 * one of them (TERM-11). Mirrors useCarrierApplicationStatus exactly:
 * fired unconditionally for every signed-in user, same as
 * `useUnreadMessages` — `GET /terminal/me` answers 403 for the overwhelming
 * majority who are not terminal staff.
 *
 * MDF-720: a real Terminal Manager's own nav link never appeared within 15
 * seconds after landing on the dashboard, even though the account, invite
 * flow and `GET /terminal/me` itself were all confirmed fine in isolation
 * (Dwight's live run). Root cause -- every error, a confirmed 403 or a
 * transient network/timeout/5xx alike, was caught into the same bucket and
 * left `isMember` false forever, no retry. A real member on a slow
 * connection or during a brief API blip therefore saw exactly what a
 * genuine non-member sees: no nav entry, no spinner, no error, nothing to
 * tell them the platform has a terminal workspace at all.
 *
 * The fix distinguishes a REAL 403 (the common, definitive "not a member"
 * signal -- stop, same as before) from anything else (network failure,
 * timeout, a 5xx): those are never evidence of non-membership, so they
 * retry on a capped backoff instead of permanently collapsing into the
 * same "hidden" state a true non-member gets. Exists only so the nav
 * (DashboardNavList) can surface a workspace that is otherwise reachable
 * no other way; the terminal workspace page itself reads `/terminal/me`
 * again on its own terms and does not depend on this hook for anything but
 * visibility.
 */
export function useTerminalMembership(): boolean {
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function check() {
      api
        .get('/terminal/me')
        .then(() => {
          if (!cancelled) setIsMember(true);
        })
        .catch((e) => {
          if (cancelled) return;
          if ((e as ApiError)?.status === 403) return; // definitive: not a member, stop retrying
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
  }, []);

  return isMember;
}
