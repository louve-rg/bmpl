'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

const POLL_MS = 60_000;

/**
 * Best-effort unread-messages count for the Messages nav badge.
 *
 * Extracted from the sidebar because the mobile drawer needs the same number and
 * a second inline copy would mean a second poll on every dashboard page. Errors
 * are swallowed: a missing badge is a cosmetic degradation, an error banner over
 * the navigation is not.
 */
export function useUnreadMessages(): number {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>('/conversations/unread-count');
      setUnread(count);
    } catch {
      /* silent — badge is best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return unread;
}
