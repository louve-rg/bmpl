'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { audienceForRoles, notificationHref } from '@bmpl/shared';
import { api } from '../../lib/api';
import {
  relativeTime,
  type NotificationItem,
  type NotificationListResponse,
} from '../../lib/notifications';
import { Spinner } from '../ui';
import { badgeCount, unreadLabel } from '../../lib/badge';

const POLL_MS = 60_000;

export function NotificationBell({ roleCodes = [] }: { roleCodes?: readonly string[] } = {}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>('/notifications/unread-count');
      setCount(count);
    } catch {
      /* silent — badge is best-effort */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<NotificationListResponse>('/notifications?limit=10');
      setItems(res.items);
      setCount(res.unreadCount);
    } catch {
      setError('Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the unread count.
  useEffect(() => {
    void refreshCount();
    const id = setInterval(() => void refreshCount(), POLL_MS);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Refetch the list whenever the panel opens.
  useEffect(() => {
    if (open) void loadItems();
  }, [open, loadItems]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markRead(item: NotificationItem) {
    if (item.read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setCount((c) => Math.max(0, c - 1));
    try {
      await api.patch(`/notifications/${item.id}/read`);
    } catch {
      void refreshCount();
    }
  }

  /**
   * Mark read, then go to whatever the notification is about.
   *
   * Clicking used to only mark it read, leaving the reader to go and find the
   * thing themselves — a driver told "New delivery offer" had to hunt for the
   * delivery. The target comes from the notification's own `data` payload.
   *
   * The read call is deliberately NOT awaited before navigating: the optimistic
   * update has already dropped the badge, and making someone watch a spinner
   * before their order opens is the wrong trade. A failed read self-corrects on
   * the next poll.
   */
  async function open_(item: NotificationItem) {
    void markRead(item);
    const href = notificationHref(
      { category: item.category, event: item.event, data: item.data },
      audienceForRoles(roleCodes, { category: item.category, data: item.data }),
    );
    // No specific target (e.g. a broadcast announcement) → stay put rather than
    // dumping the reader on an unrelated page.
    if (!href) return;
    setOpen(false);
    router.push(href);
  }

  async function dismiss(item: NotificationItem) {
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    if (!item.read) setCount((c) => Math.max(0, c - 1));
    try {
      await api.del(`/notifications/${item.id}`);
    } catch {
      void loadItems();
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setCount(0);
    try {
      await api.patch('/notifications/read-all');
    } catch {
      void loadItems();
    }
  }

  const badge = badgeCount(count);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Notifications, ${unreadLabel(count)}` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-belize-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-belize-accent px-1 text-[10px] font-bold leading-[18px] text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-bmpl-lg border border-slate-200 bg-white shadow-bmpl-md"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-belize-navy">Notifications</p>
            <button
              type="button"
              onClick={markAllRead}
              disabled={count === 0}
              className="text-xs font-semibold text-belize-blue transition hover:text-belize-deep disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                <Spinner className="h-4 w-4" /> Loading…
              </div>
            ) : error ? (
              <p className="px-4 py-10 text-center text-sm text-red-600">{error}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You&rsquo;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`group relative px-4 py-3 transition hover:bg-slate-50 ${item.read ? '' : 'bg-belize-blue/[0.03]'}`}
                  >
                    <button type="button" onClick={() => void open_(item)} className="block w-full pr-6 text-left">
                      <div className="flex items-start gap-2">
                        {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-belize-accent" aria-hidden />}
                        <div className={`min-w-0 ${item.read ? 'pl-4' : ''}`}>
                          <p className={`truncate text-sm ${item.read ? 'font-medium text-slate-700' : 'font-semibold text-belize-navy'}`}>
                            {item.title}
                          </p>
                          {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p>}
                          <p className="mt-1 text-[11px] text-slate-400">{relativeTime(item.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(item)}
                      aria-label="Dismiss notification"
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent sm:hidden sm:group-hover:flex sm:group-focus-within:flex"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2.5 text-center">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="text-sm font-semibold text-belize-blue transition hover:text-belize-deep"
            >
              View all →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
