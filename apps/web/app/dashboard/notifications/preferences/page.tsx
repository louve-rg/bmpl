'use client';

import { useEffect, useState } from 'react';
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@bmpl/shared';
import { api } from '../../../../lib/api';
import type { NotificationPreference } from '../../../../lib/notifications';
import { PageHeader, Card, Alert, Spinner, ButtonLink } from '../../../../components/ui';

type Channel = 'inApp' | 'email' | 'push';

export default function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<NotificationPreference[]>('/notifications/preferences');
        setPrefs(data);
      } catch {
        setError('Could not load notification preferences.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function toggle(category: NotificationCategory, channel: Channel, value: boolean) {
    const key = `${category}:${channel}`;
    setSavingKey(key);
    setError(null);
    // optimistic
    setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, [channel]: value } : p)));
    try {
      const updated = await api.put<NotificationPreference[]>('/notifications/preferences', {
        category,
        [channel]: value,
      });
      setPrefs(updated);
    } catch {
      setError('Could not save that change.');
      // revert
      setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, [channel]: !value } : p)));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Notification preferences"
        description="Choose which channels deliver each type of update."
        actions={
          <ButtonLink href="/dashboard/notifications" variant="outline" size="sm">
            ← Back to notifications
          </ButtonLink>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Alert tone="info">
        In-app notifications are always delivered. Email and push delivery are <strong>coming soon</strong> — your choices here are
        saved and will apply once those channels launch.
      </Alert>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* header row */}
          <div className="hidden grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:grid">
            <span>Category</span>
            <ChannelHead>In-app</ChannelHead>
            <ChannelHead>Email</ChannelHead>
            <ChannelHead>Push</ChannelHead>
          </div>

          <ul className="divide-y divide-slate-100">
            {prefs.map((p) => (
              <li
                key={p.category}
                className="grid grid-cols-2 items-center gap-4 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto]"
              >
                <span className="col-span-2 text-sm font-semibold text-belize-navy sm:col-span-1">
                  {NOTIFICATION_CATEGORY_LABELS[p.category] ?? p.category}
                </span>
                <Toggle
                  label="In-app"
                  checked={p.inApp}
                  busy={savingKey === `${p.category}:inApp`}
                  onChange={(v) => toggle(p.category, 'inApp', v)}
                />
                <Toggle
                  label="Email"
                  checked={p.email}
                  busy={savingKey === `${p.category}:email`}
                  onChange={(v) => toggle(p.category, 'email', v)}
                />
                <Toggle
                  label="Push"
                  checked={p.push}
                  busy={savingKey === `${p.category}:push`}
                  onChange={(v) => toggle(p.category, 'push', v)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ChannelHead({ children }: { children: React.ReactNode }) {
  return <span className="w-14 text-center">{children}</span>;
}

function Toggle({
  label,
  checked,
  busy,
  onChange,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 sm:w-14 sm:justify-center">
      <span className="text-xs text-slate-500 sm:hidden">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-belize-blue' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
