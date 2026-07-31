'use client';

import { useEffect, useState } from 'react';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@bmpl/shared';
import { api } from '../../lib/api';
import type { NotificationPreference } from '../../lib/notifications';
import { Alert, Badge, Card, Spinner } from '../ui';

type PrefMap = Record<NotificationCategory, NotificationPreference>;

function defaults(): PrefMap {
  return NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    acc[category] = { category, inApp: true, email: false, push: false };
    return acc;
  }, {} as PrefMap);
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-belize-blue' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function PreferencesPanel() {
  const [prefs, setPrefs] = useState<PrefMap>(defaults);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<NotificationCategory | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const rows = await api.get<NotificationPreference[]>('/notifications/preferences');
        if (!alive) return;
        setPrefs((prev) => {
          const next = { ...prev };
          for (const row of rows ?? []) {
            if (row?.category && next[row.category]) {
              next[row.category] = { ...next[row.category], ...row };
            }
          }
          return next;
        });
      } catch {
        if (alive) setError('Could not load preferences.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggleInApp(category: NotificationCategory) {
    const nextValue = !prefs[category].inApp;
    setPrefs((prev) => ({ ...prev, [category]: { ...prev[category], inApp: nextValue } }));
    setSaving(category);
    setError(null);
    try {
      await api.put('/notifications/preferences', { category, inApp: nextValue });
    } catch {
      setPrefs((prev) => ({ ...prev, [category]: { ...prev[category], inApp: !nextValue } }));
      setError('Could not save preference. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-belize-navy">Notification preferences</h2>
        <p className="mt-0.5 text-sm text-slate-500">Choose how you receive each category. Email and push are coming soon.</p>
      </div>

      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-10 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading preferences…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3 text-center">In-app</th>
                <th className="px-5 py-3 text-center">Email</th>
                <th className="px-5 py-3 text-center">Push</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-belize-navy">{NOTIFICATION_CATEGORY_LABELS[category]}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <Toggle
                        checked={prefs[category].inApp}
                        disabled={saving === category}
                        onChange={() => void toggleInApp(category)}
                        label={`In-app notifications for ${NOTIFICATION_CATEGORY_LABELS[category]}`}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <Toggle checked={false} disabled label="Email (coming soon)" />
                      <Badge tone="neutral">Soon</Badge>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <Toggle checked={false} disabled label="Push (coming soon)" />
                      <Badge tone="neutral">Soon</Badge>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
