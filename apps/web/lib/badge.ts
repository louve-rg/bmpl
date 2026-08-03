/**
 * Small pure helpers for unread/count badges shared by the notification bell,
 * the dashboard sidebar, and the messages list. Kept framework-free so the
 * display string and its accessible label stay consistent (and testable) across
 * every badge in the app.
 */

/** Compact badge text, capped at `${max}+` (default 99). Empty when nothing to show. */
export function badgeCount(n: number, max = 99): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > max ? `${max}+` : String(Math.floor(n));
}

/** Accessible label for an unread-count badge, e.g. "3 unread". */
export function unreadLabel(n: number): string {
  const count = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return `${count} unread`;
}
