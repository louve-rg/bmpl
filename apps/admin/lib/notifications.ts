import type { NotificationCategory } from '@bmpl/shared';

/**
 * Client-side shapes for the M16 notification feed. Mirrors the documented
 * GET /notifications response — kept here so the bell and the notification
 * center share one source of truth.
 */
export interface NotificationItem {
  id: string;
  notificationId: string;
  type: string;
  category: NotificationCategory;
  event: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationPreference {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

/**
 * Compact relative-time formatter (no deps). Falls back to a locale date for
 * anything older than a few weeks.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const s = Math.round(diffMs / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}
