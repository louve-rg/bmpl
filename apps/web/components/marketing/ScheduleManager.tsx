'use client';

import { useState } from 'react';
import { type ApiError } from '../../lib/api';
import { marketingApi, fmtDateTime, type CampaignDetail } from '../../lib/marketing';
import { Alert, Button, Card, Field, Input } from '../ui';

/** Add/remove activation windows (schedules) for a campaign. Emits the updated campaign. */
export function ScheduleManager({
  campaign,
  onChanged,
}: {
  campaign: CampaignDetail;
  onChanged: (updated: CampaignDetail) => void;
}) {
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<CampaignDetail>) {
    setError(null);
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!startAt || !endAt) return;
    await run(() =>
      marketingApi.addSchedule(campaign.id, {
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      }),
    );
    setStartAt('');
    setEndAt('');
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="bmpl-eyebrow">Schedules</h2>
      {error && <Alert tone="error">{error}</Alert>}

      {campaign.schedules.length === 0 ? (
        <p className="text-sm text-slate-400">No schedules yet.</p>
      ) : (
        <ul className="space-y-2">
          {campaign.schedules.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3 text-sm">
              <span className="text-slate-600">
                {fmtDateTime(s.startAt)} → {fmtDateTime(s.endAt)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => marketingApi.removeSchedule(campaign.id, s.id))}
                className="font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Starts">
          <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <Field label="Ends">
          <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
        <Button type="button" variant="outline" disabled={busy || !startAt || !endAt} onClick={add}>
          Add schedule
        </Button>
      </div>
    </Card>
  );
}
