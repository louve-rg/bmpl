'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { relativeTime, type NotificationFeed, type NotificationItem } from '../../lib/notifications';
import { Spinner } from '../ui';
import { CategoryChip } from './CategoryChip';

const POLL_MS = 60_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const res = await api.get<{ count: number }>('/notifications/unread-count');
      setCount(res.count);
    } catch {
      /* transient — the next poll retries */
    }
  }, []);

  // Poll the unread count on an interval.
  useEffect(() => {
    void loadCount();
    const id = window.setInterval(() => void loadCount(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadCount]);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<NotificationFeed>('/notifications?limit=10');
      setItems(res.items);
      setCount(res.unreadCount);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) void loadPanel();
      return next;
    });
  }

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
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
      void loadPanel();
      void loadCount();
    }
  }

  async function dismiss(item: NotificationItem, e: React.MouseEvent) {
    e.stopPropagation();
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    if (!item.read) setCount((c) => Math.max(0, c - 1));
    try {
      await api.del(`/notifications/${item.id}`);
    } catch {
      void loadPanel();
      void loadCount();
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setCount(0);
    try {
      await api.patch('/notifications/read-all');
    } catch {
      void loadPanel();
      void loadCount();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative flex h-10 w-10 items-center justify-center rounded-bmpl-md text-slate-600 transition hover:bg-slate-100 hover:text-belize-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0" />
        </svg>
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-belize-accent px-1 text-[0.65rem] font-bold leading-4 text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 flex w-[20rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-lg sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-belize-navy">Notifications</p>
            <button
              type="button"
              onClick={markAll}
              disabled={items.every((n) => n.read)}
              className="text-xs font-semibold text-belize-blue transition hover:underline disabled:opacity-40 disabled:hover:no-underline"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                <Spinner className="h-4 w-4" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You&apos;re all caught up.</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => void markRead(n)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void markRead(n);
                        }
                      }}
                      className={`group flex cursor-pointer items-start gap-2 border-b border-slate-50 px-4 py-3 transition hover:bg-slate-50 ${n.read ? '' : 'bg-belize-blue/5'}`}
                    >
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-belize-accent" aria-label="Unread" />}
                      <div className={`min-w-0 flex-1 ${n.read ? 'pl-4' : ''}`}>
                        <div className="mb-1 flex items-center gap-2">
                          <CategoryChip category={n.category} />
                          <span className="ml-auto shrink-0 text-[0.7rem] text-slate-400">{relativeTime(n.createdAt)}</span>
                        </div>
                        <p className="truncate text-sm font-semibold text-belize-navy">{n.title}</p>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => void dismiss(n, e)}
                        aria-label="Dismiss"
                        className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 focus:opacity-100 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-slate-100 px-4 py-3 text-center text-sm font-semibold text-belize-blue transition hover:bg-slate-50"
          >
            View all →
          </Link>
        </div>
      )}
    </div>
  );
}
