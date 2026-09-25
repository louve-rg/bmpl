'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { Alert, Button, Input, Select, Spinner, Textarea } from '../../../../components/ui';

/**
 * Whether THIS route runs on a given day - the CONFIGURATION capability from
 * BMPL-186. No real schedule is seeded anywhere; every row here is entered by
 * hand, by whoever holds logistics.manage, for a route that already exists.
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_OPTIONS = ['OPERATING', 'REDUCED', 'NOT_OPERATING'] as const;
type Status = (typeof STATUS_OPTIONS)[number];
const STATUS_LABELS: Record<Status, string> = { OPERATING: 'Operating', REDUCED: 'Reduced', NOT_OPERATING: 'Not operating' };

interface ScheduleDay {
  dayOfWeek: number;
  status: Status;
  note: string | null;
}

interface ScheduleException {
  id: string;
  date: string;
  status: Status;
  reason: string | null;
}

interface RouteSchedule {
  days: ScheduleDay[];
  exceptions: ScheduleException[];
}

/** All seven days, defaulting to OPERATING where the route has no configured row yet. */
function fullWeek(configured: ScheduleDay[]): ScheduleDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const found = configured.find((d) => d.dayOfWeek === dayOfWeek);
    return found ?? { dayOfWeek, status: 'OPERATING' as Status, note: null };
  });
}

export function RouteScheduleEditor({ routeId }: { routeId: string }) {
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingWeek, setSavingWeek] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newException, setNewException] = useState({ date: '', status: 'NOT_OPERATING' as Status, reason: '' });
  const [addingException, setAddingException] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get<RouteSchedule>(`/admin/logistics/routes/${routeId}/schedule`);
      setDays(fullWeek(s.days));
      setExceptions(s.exceptions);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load this route\'s schedule.');
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveWeek() {
    if (!days) return;
    setSavingWeek(true);
    setErr(null);
    try {
      await api.put(`/admin/logistics/routes/${routeId}/schedule`, {
        days: days.map((d) => ({ dayOfWeek: d.dayOfWeek, status: d.status, note: d.note || undefined })),
      });
    } catch (e) {
      const a = e as ApiError;
      setErr(a.errors?.[0]?.message ?? a.message ?? 'Could not save the weekly pattern.');
    } finally {
      setSavingWeek(false);
    }
  }

  async function addException() {
    if (!newException.date) return;
    setAddingException(true);
    setErr(null);
    try {
      await api.post(`/admin/logistics/routes/${routeId}/schedule/exceptions`, {
        date: newException.date,
        status: newException.status,
        reason: newException.reason || undefined,
      });
      setNewException({ date: '', status: 'NOT_OPERATING', reason: '' });
      await load();
    } catch (e) {
      const a = e as ApiError;
      setErr(a.errors?.[0]?.message ?? a.message ?? 'Could not add that exception.');
    } finally {
      setAddingException(false);
    }
  }

  async function removeException(id: string) {
    setErr(null);
    try {
      await api.del(`/admin/logistics/routes/${routeId}/schedule/exceptions/${id}`);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not remove that exception.');
    }
  }

  if (loading || !days) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading schedule…
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {err && <Alert tone="warning" className="mb-3">{err}</Alert>}

      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly pattern</h3>
      <p className="mt-1 text-xs text-slate-500">A day with no exception below follows this pattern. Absent entirely, a route is treated as operating.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-7">
        {days.map((d, i) => (
          <div key={d.dayOfWeek} className="rounded-md border border-slate-200 p-2">
            <div className="text-xs font-semibold text-slate-700">{DAY_LABELS[d.dayOfWeek]}</div>
            <Select
              className="mt-1 text-xs"
              value={d.status}
              onChange={(e) => {
                const next = [...days];
                next[i] = { ...d, status: e.target.value as Status };
                setDays(next);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
            {d.status === 'REDUCED' && (
              <Input
                className="mt-1 text-xs"
                placeholder="Why reduced?"
                value={d.note ?? ''}
                onChange={(e) => {
                  const next = [...days];
                  next[i] = { ...d, note: e.target.value };
                  setDays(next);
                }}
              />
            )}
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={() => void saveWeek()} disabled={savingWeek}>
        {savingWeek ? 'Saving…' : 'Save weekly pattern'}
      </Button>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Date-specific exceptions</h3>
      <p className="mt-1 text-xs text-slate-500">A known future closure, a carrier-observed holiday, a one-off reduced run — overrides the weekly pattern for that date only.</p>
      {exceptions.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No exceptions configured.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs">
              <span>
                <strong>{e.date}</strong> — {STATUS_LABELS[e.status]}
                {e.reason ? ` (${e.reason})` : ''}
              </span>
              <Button variant="outline" size="sm" onClick={() => void removeException(e.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <Input
          type="date"
          value={newException.date}
          onChange={(e) => setNewException({ ...newException, date: e.target.value })}
        />
        <Select
          value={newException.status}
          onChange={(e) => setNewException({ ...newException, status: e.target.value as Status })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </Select>
        <Textarea
          className="sm:col-span-2"
          placeholder="Reason (the carrier's own words - never invented here)"
          value={newException.reason}
          onChange={(e) => setNewException({ ...newException, reason: e.target.value })}
          rows={1}
        />
      </div>
      <Button size="sm" className="mt-2" onClick={() => void addException()} disabled={addingException || !newException.date}>
        {addingException ? 'Adding…' : 'Add exception'}
      </Button>
    </div>
  );
}
