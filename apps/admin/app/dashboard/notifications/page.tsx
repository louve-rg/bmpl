'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from '@bmpl/shared';
import { api } from '../../../lib/api';
import { relativeTime, type NotificationFeed, type NotificationItem } from '../../../lib/notifications';
import { CategoryChip } from '../../../components/notifications/CategoryChip';
import { PreferencesPanel } from '../../../components/notifications/PreferencesPanel';
import { Alert, Button, EmptyState, PageHeader, Spinner } from '../../../components/ui';

const ALL_KEY = '__all__';
const PAGE_SIZE = 20;

/** Quick-filter chips shown above the full-category dropdown. */
const QUICK_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'ADMIN', label: 'System & moderation' },
  { key: 'ADMIN_ALERT', label: NOTIFICATION_CATEGORY_LABELS.ADMIN_ALERT },
  { key: 'SECURITY', label: NOTIFICATION_CATEGORY_LABELS.SECURITY },
  { key: 'ALL', label: 'All' },
];

/** Which categories a filter key resolves to. `null` means "no category filter". */
function resolveCategories(key: string): NotificationCategory[] | null {
  if (key === 'ALL') return null;
  if (key === 'ADMIN') return [...ADMIN_NOTIFICATION_CATEGORIES];
  return [key as NotificationCategory];
}

type Cursors = Record<string, string | null>;

export default function NotificationsPage() {
  const [filterKey, setFilterKey] = useState<string>('ADMIN');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursors, setCursors] = useState<Cursors>({});
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (reset: boolean, currentCursors: Cursors) => {
      const cats = resolveCategories(filterKey);
      const keys = cats ?? [ALL_KEY];

      const requests = keys.map((k) => {
        const cursor = reset ? undefined : currentCursors[k];
        // Skip categories that are already exhausted on "load more".
        if (!reset && cursor === null) return Promise.resolve(null);
        const params = new URLSearchParams();
        if (k !== ALL_KEY) params.set('category', k);
        if (unreadOnly) params.set('unread', 'true');
        if (cursor) params.set('cursor', cursor);
        params.set('limit', String(PAGE_SIZE));
        return api
          .get<NotificationFeed>(`/notifications?${params.toString()}`)
          .then((res) => ({ key: k as string, res }));
      });

      const settled = await Promise.all(requests);
      const results = settled.filter(
        (r): r is { key: string; res: NotificationFeed } => r !== null,
      );

      const nextCursors: Cursors = reset ? {} : { ...currentCursors };
      let unread = 0;
      const incoming: NotificationItem[] = [];
      for (const { key, res } of results) {
        nextCursors[key] = res.nextCursor ?? null;
        unread += res.unreadCount ?? 0;
        incoming.push(...res.items);
      }

      setItems((prev) => {
        const merged = reset ? incoming : [...prev, ...incoming];
        const seen = new Set<string>();
        return merged
          .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      setCursors(nextCursors);
      setHasMore(keys.some((k) => nextCursors[k]));
      setUnreadCount(unread);
    },
    [filterKey, unreadOnly],
  );

  // Reload from scratch whenever the filter or unread toggle changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await fetchPage(true, {});
      } catch {
        if (alive) setError('Could not load notifications.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      await fetchPage(false, cursors);
    } catch {
      setError('Could not load more notifications.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(item: NotificationItem) {
    if (item.read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.patch(`/notifications/${item.id}/read`);
    } catch {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: false } : n)));
      setUnreadCount((c) => c + 1);
    }
  }

  async function dismiss(item: NotificationItem, e: React.MouseEvent) {
    e.stopPropagation();
    const prevItems = items;
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    if (!item.read) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.del(`/notifications/${item.id}`);
    } catch {
      setItems(prevItems);
      if (!item.read) setUnreadCount((c) => c + 1);
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.patch('/notifications/read-all');
    } catch {
      setError('Could not mark all as read.');
    }
  }

  const dropdownValue = ['ADMIN', 'ALL', 'ADMIN_ALERT', 'SECURITY'].includes(filterKey) ? '' : filterKey;
  const allRead = items.every((n) => n.read);

  return (
    <div>
      <PageHeader
        eyebrow="Notifications"
        title="Notification center"
        description="System and moderation alerts — vendor and driver applications, order exceptions, failed deliveries, and security events."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowPrefs((v) => !v)}>
              {showPrefs ? 'Hide preferences' : 'Preferences'}
            </Button>
            <Button variant="ghost" size="sm" onClick={markAll} disabled={allRead || items.length === 0}>
              Mark all read
            </Button>
          </>
        }
      />

      {showPrefs && (
        <div className="mb-6">
          <PreferencesPanel />
        </div>
      )}

      {/* Quick filters + full category picker + unread toggle */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_FILTERS.map((f) => {
            const active = filterKey === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilterKey(f.key)}
                aria-pressed={active}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-belize-blue text-white shadow-bmpl-sm'
                    : 'border border-slate-300 text-belize-navy hover:border-belize-blue hover:bg-belize-blue/5'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <select
            className="bmpl-input h-9 py-0 text-sm"
            value={dropdownValue}
            onChange={(e) => setFilterKey(e.target.value || 'ADMIN')}
            aria-label="Filter by category"
          >
            <option value="">Filter by category…</option>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {NOTIFICATION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-belize-navy">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
            />
            Unread only
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No notifications"
          description={unreadOnly ? 'No unread notifications for this filter.' : 'Nothing to show for this filter yet.'}
        />
      ) : (
        <>
          <ul className="overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white">
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
                  className={`group flex cursor-pointer items-start gap-3 border-b border-slate-100 px-4 py-4 transition last:border-b-0 hover:bg-slate-50 ${
                    n.read ? '' : 'bg-belize-blue/5'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-belize-accent'}`}
                    aria-label={n.read ? undefined : 'Unread'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <CategoryChip category={n.category} />
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{relativeTime(n.createdAt)}</span>
                    </div>
                    <p className={`text-sm ${n.read ? 'font-medium text-belize-navy' : 'font-semibold text-belize-navy'}`}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => void dismiss(n, e)}
                    aria-label="Dismiss"
                    className="shrink-0 rounded p-1.5 text-slate-300 transition hover:bg-slate-200 hover:text-slate-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="mt-5 flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <Spinner className="h-4 w-4" /> Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
