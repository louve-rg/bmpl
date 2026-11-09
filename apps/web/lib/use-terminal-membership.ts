'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Whether the signed-in user has an active terminal company membership —
 * independent of the 14 account role codes, since terminal staff are not
 * one of them (TERM-11). Mirrors useCarrierApplicationStatus exactly:
 * fired unconditionally for every signed-in user, same as
 * `useUnreadMessages` — `GET /terminal/me` answers 403 for the overwhelming
 * majority who are not terminal staff. Best-effort: a failed fetch (403 or
 * otherwise) leaves the nav exactly as it was (false), same as having no
 * membership — a missing nav entry is a smaller problem than an error
 * banner in the sidebar. Exists only so the nav (DashboardNavList) can
 * surface a workspace that is otherwise reachable no other way; the
 * terminal workspace page itself reads `/terminal/me` again on its own
 * terms and does not depend on this hook for anything but visibility.
 */
export function useTerminalMembership(): boolean {
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/terminal/me')
      .then(() => {
        if (!cancelled) setIsMember(true);
      })
      .catch(() => {
        /* silent — best-effort, see doc comment above; 403 is the common case */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return isMember;
}
