import type { NotificationCategory } from '@bmpl/shared';

/** A single notification record as returned by the API. `id` is the handle used
 *  for read/delete operations. */
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

export interface NotificationListResponse {
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

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: 'day', ms: 1000 * 60 * 60 * 24 },
  { unit: 'hour', ms: 1000 * 60 * 60 },
  { unit: 'minute', ms: 1000 * 60 },
];

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

/** Compact relative time, e.g. "just now", "5 minutes ago", "3 days ago". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  if (abs < 45 * 1000) return 'just now';
  for (const { unit, ms } of RELATIVE_UNITS) {
    if (abs >= ms) {
      const value = Math.round(diff / ms);
      return rtf ? rtf.format(value, unit) : `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
