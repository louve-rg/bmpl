'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@bmpl/shared';
import { api } from '../../../lib/api';
import {
  relativeTime,
  type NotificationItem,
  type NotificationListResponse,
} from '../../../lib/notifications';
import { markNotificationRead, useOpenNotification } from '../../../lib/use-open-notification';
import type { MeView } from '../../../lib/types';
import { PageHeader, Card, Badge, Button, ButtonLink, Alert, Spinner, EmptyState } from '../../../components/ui';

type Filter = NotificationCategory | 'ALL';

export default function NotificationsPage() {
  const [category, setCategory] = useState<Filter>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // APPROVED roles decide which audience's routes a notification resolves to.
  // The bell gets these from the dashboard layout, which already has `me`; this
  // page is a route child and cannot be handed props, so it reads them itself.
  // Failure is non-fatal — an empty set just resolves customer routes.
  const [roleCodes, setRoleCodes] = useState<readonly string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get<MeView>('/me')
      .then((me) => {
        if (!cancelled) setRoleCodes(me.roles.filter((r) => r.status === 'APPROVED').map((r) => r.roleCode));
      })
      .catch(() => {
        /* non-fatal — see above */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: '20' });
      if (category !== 'ALL') params.set('category', category);
      if (unreadOnly) params.set('unread', 'true');
      if (cursor) params.set('cursor', cursor);
      return `/notifications?${params.toString()}`;
    },
    [category, unreadOnly],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<NotificationListResponse>(buildQuery());
      setItems(res.items);
      setNextCursor(res.nextCursor);
      setUnreadCount(res.unreadCount);
    } catch {
      setError('Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await api.get<NotificationListResponse>(buildQuery(nextCursor));
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
      setUnreadCount(res.unreadCount);
    } catch {
      setError('Could not load more notifications.');
    } finally {
      setLoadingMore(false);
    }
  }

  const markRead = useCallback((item: NotificationItem) => {
    if (item.read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    void markNotificationRead(item.id, () => void load());
  }, [load]);

  /**
   * Clicking an item here used to ONLY mark it read, while the bell showing the
   * same list navigated to the thing. "View all" is the most likely way a driver
   * reaches this page, so the surface with the most items was the one that went
   * nowhere. Both now share one handler.
   */
  const openNotification = useOpenNotification({ roleCodes, onRead: markRead });

  async function dismiss(item: NotificationItem) {
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    if (!item.read) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.del(`/notifications/${item.id}`);
    } catch {
      void load();
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.patch('/notifications/read-all');
    } catch {
      void load();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Notifications"
        description="Order, payment, delivery, and account updates."
        actions={
          <>
            <ButtonLink href="/dashboard/notifications/preferences" variant="outline" size="sm">
              Preferences
            </ButtonLink>
            <Button type="button" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
              Mark all read
            </Button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Chip active={category === 'ALL'} onClick={() => setCategory('ALL')}>
            All
          </Chip>
          {NOTIFICATION_CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {NOTIFICATION_CATEGORY_LABELS[c]}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
          {unreadCount > 0 && <Badge tone="brand">{unreadCount} unread</Badge>}
        </label>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No notifications"
          description={unreadOnly || category !== 'ALL' ? 'Nothing matches this filter.' : 'You’re all caught up.'}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Card className={`p-4 transition ${item.read ? '' : 'ring-1 ring-belize-blue/20'}`}>
                  <div className="flex items-start gap-3">
                    {!item.read ? (
                      <>
                        <span className="sr-only">Unread notification.</span>
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-belize-accent" aria-hidden />
                      </>
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
                    )}
                    <button type="button" onClick={() => openNotification(item)} className="min-w-0 flex-1 text-left">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{NOTIFICATION_CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                        <span className="text-xs text-slate-400">{relativeTime(item.createdAt)}</span>
                      </div>
                      <p className={`text-sm ${item.read ? 'font-medium text-slate-700' : 'font-semibold text-belize-navy'}`}>
                        {item.title}
                      </p>
                      {item.body && <p className="mt-0.5 text-sm text-slate-500">{item.body}</p>}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {!item.read && (
                        <button
                          type="button"
                          onClick={() => markRead(item)}
                          className="rounded-full px-2 py-1 text-xs font-semibold text-belize-blue transition hover:bg-belize-blue/5"
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => dismiss(item)}
                        aria-label="Dismiss notification"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}

      <p className="text-center text-xs text-slate-400">
        Manage which updates you receive in{' '}
        <Link href="/dashboard/notifications/preferences" className="font-semibold text-belize-blue hover:text-belize-deep">
          Preferences
        </Link>
        .
      </p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'border-belize-blue bg-belize-blue text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-belize-blue hover:text-belize-navy'
      }`}
    >
      {children}
    </button>
  );
}
