'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { audienceForRoles, notificationHref } from '@bmpl/shared';
import { api } from './api';
import type { NotificationItem } from './notifications';

/**
 * What happens when someone clicks a notification, defined ONCE.
 *
 * The bell resolved a target and navigated; the notification centre only marked
 * the item read and left the reader where they were. Two surfaces showing the
 * same list behaved differently, and the one the client is most likely to open
 * from a deep link — "View all" → the centre — was the one that went nowhere.
 * Both now call this.
 *
 * SECURITY: this resolves a ROUTE, never permission. Every target is an ordinary
 * authorized page; a recipient who cannot view the entity gets that page's normal
 * 403/404. Nothing here can turn a notification into access.
 */
export function useOpenNotification({
  roleCodes,
  onRead,
  onNavigate,
}: {
  /** APPROVED role codes — decides which audience's routes apply. */
  roleCodes: readonly string[];
  /** Optimistic local read-state update (the caller owns its list + unread count). */
  onRead: (item: NotificationItem) => void;
  /** Called just before navigating — the bell uses it to close its panel. */
  onNavigate?: () => void;
}) {
  const router = useRouter();

  return useCallback(
    (item: NotificationItem) => {
      if (!item.read) onRead(item);

      const href = notificationHref(
        { category: item.category, event: item.event, data: item.data },
        audienceForRoles(roleCodes, { category: item.category, data: item.data }),
      );

      // No specific target (a broadcast announcement has no entity) → stay put.
      // Dumping the reader on an unrelated page is worse than not moving.
      if (!href) return;
      onNavigate?.();
      router.push(href);
    },
    [onNavigate, onRead, roleCodes, router],
  );
}

/**
 * Mark one notification read on the server, best-effort.
 *
 * Deliberately NOT awaited before navigating: the optimistic update has already
 * dropped the badge, and making someone watch a spinner before their delivery
 * opens is the wrong trade. A failure self-corrects on the next poll/reload.
 */
export async function markNotificationRead(id: string, onError?: () => void): Promise<void> {
  try {
    await api.patch(`/notifications/${id}/read`);
  } catch {
    onError?.();
  }
}
