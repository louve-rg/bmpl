'use client';

import { useCallback, useEffect, useState } from 'react';
import { HUB_HOURS_EXCEPTION_STATUSES, HUB_HOURS_EXCEPTION_STATUS_LABELS, type HubHoursExceptionStatus } from '@bmpl/shared';
import { api, type ApiError } from '../../../../lib/api';
import { Alert, Button, Input, Select, Spinner, Textarea } from '../../../../components/ui';

/**
 * A terminal's structured opening hours and date exceptions (BMPL-177/263).
 *
 * NO CONSUMER READS THESE ROWS YET (packages/shared/src/hub-hours.ts is a
 * pure, unwired resolver) — this screen is configuration only, and that is
 * the whole reason the empty state below says what it says. A day or date
 * with no row here is UNCONSTRAINED, not closed: the resolver's own
 * documented default treats "nothing configured" as open with no window to
 * report, specifically so that entering nothing changes nothing and a
 * terminal that has never had its hours touched behaves exactly as it does
 * today. Saying "Closed" for an empty slot would assert the opposite of
 * what the system actually does.
 *
 * No real terminal has any hours configured anywhere, and none are invented
 * here as placeholder content — every row on screen is either what an
 * operator already saved, or a blank draft an operator is actively filling
 * in before Save.
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface HubDay {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string; // '' = not yet filled in; never a fabricated default
  closeTime: string;
}

interface HubException {
  id: string;
  date: string;
  status: HubHoursExceptionStatus;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
}

interface HubHoursResponse {
  hubId: string;
  days: Array<{ dayOfWeek: number; isClosed: boolean; openTime: string | null; closeTime: string | null }>;
  exceptions: HubException[];
}

/** Whether this day, if included in the submitted set, is actually complete
 *  — closed needs nothing, open needs BOTH times with open before close.
 *  The API's own Zod refine enforces the identical rule; this exists so an
 *  operator sees an incomplete day as unsavable rather than discovering it
 *  in a 400. */
function dayValid(d: HubDay): boolean {
  return d.isClosed || (!!d.openTime && !!d.closeTime && d.openTime < d.closeTime);
}

function timeRange(openTime: string | null, closeTime: string | null): string {
  return openTime && closeTime ? `${openTime}–${closeTime}` : '';
}

const blankException = { date: '', status: 'CLOSED' as HubHoursExceptionStatus, openTime: '', closeTime: '', reason: '' };

export function HubHoursEditor({ hubId, canManage }: { hubId: string; canManage: boolean }) {
  const [days, setDays] = useState<HubDay[] | null>(null);
  const [exceptions, setExceptions] = useState<HubException[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingWeek, setSavingWeek] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newException, setNewException] = useState({ ...blankException });
  const [addingException, setAddingException] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await api.get<HubHoursResponse>(`/admin/logistics/hubs/${hubId}/hours`);
      setDays(h.days.map((d) => ({ dayOfWeek: d.dayOfWeek, isClosed: d.isClosed, openTime: d.openTime ?? '', closeTime: d.closeTime ?? '' })));
      setExceptions(h.exceptions);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? "Could not load this terminal's hours.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    void load();
  }, [load]);

  function addDay(dayOfWeek: number) {
    if (!days) return;
    setDays([...days, { dayOfWeek, isClosed: false, openTime: '', closeTime: '' }]);
  }

  function removeDay(dayOfWeek: number) {
    if (!days) return;
    setDays(days.filter((d) => d.dayOfWeek !== dayOfWeek));
  }

  function updateDay(dayOfWeek: number, patch: Partial<HubDay>) {
    if (!days) return;
    setDays(days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  async function saveWeek() {
    if (!days) return;
    setSavingWeek(true);
    setErr(null);
    try {
      await api.put(`/admin/logistics/hubs/${hubId}/hours`, {
        days: days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          openTime: d.isClosed ? undefined : d.openTime,
          closeTime: d.isClosed ? undefined : d.closeTime,
        })),
      });
      await load();
    } catch (e) {
      const a = e as ApiError;
      setErr(a.errors?.[0]?.message ?? a.message ?? 'Could not save the weekly pattern.');
    } finally {
      setSavingWeek(false);
    }
  }

  const exceptionValid =
    !!newException.date &&
    (newException.status === 'CLOSED'
      ? true
      : !!newException.openTime && !!newException.closeTime && newException.openTime < newException.closeTime);

  async function addException() {
    if (!exceptionValid) return;
    setAddingException(true);
    setErr(null);
    try {
      await api.post(`/admin/logistics/hubs/${hubId}/hours/exceptions`, {
        date: newException.date,
        status: newException.status,
        openTime: newException.status === 'MODIFIED' ? newException.openTime : undefined,
        closeTime: newException.status === 'MODIFIED' ? newException.closeTime : undefined,
        reason: newException.reason || undefined,
      });
      setNewException({ ...blankException });
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
      await api.del(`/admin/logistics/hubs/${hubId}/hours/exceptions/${id}`);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not remove that exception.');
    }
  }

  if (loading || !days) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading hours…
      </div>
    );
  }

  const weekCanSave = days.every(dayValid);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {err && <Alert tone="warning" className="mb-3">{err}</Alert>}

      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly pattern</h3>
      <p className="mt-1 text-xs text-slate-500">
        A day left unconfigured is unconstrained, not closed — nothing yet reads these hours to gate or warn about
        anything, so a terminal with nothing set here behaves exactly as it does today. Saving replaces the whole
        week: a day left out of the set below becomes unconfigured again, not closed.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-7">
        {DAY_LABELS.map((label, dayOfWeek) => {
          const d = days.find((x) => x.dayOfWeek === dayOfWeek);
          return (
            <div key={dayOfWeek} className="rounded-md border border-slate-200 p-2">
              <div className="text-xs font-semibold text-slate-700">{label}</div>
              {!d ? (
                <>
                  <p className="mt-1 text-[11px] text-slate-400">Unconfigured</p>
                  {canManage && (
                    <Button variant="outline" size="sm" className="mt-1 w-full text-xs" onClick={() => addDay(dayOfWeek)}>
                      Add hours
                    </Button>
                  )}
                </>
              ) : canManage ? (
                <>
                  <Select
                    className="mt-1 text-xs"
                    value={d.isClosed ? 'CLOSED' : 'OPEN'}
                    onChange={(e) => updateDay(dayOfWeek, { isClosed: e.target.value === 'CLOSED' })}
                  >
                    <option value="OPEN">Open</option>
                    <option value="CLOSED">Closed</option>
                  </Select>
                  {!d.isClosed && (
                    <div className="mt-1 space-y-1">
                      <Input type="time" className="text-xs" value={d.openTime} onChange={(e) => updateDay(dayOfWeek, { openTime: e.target.value })} />
                      <Input type="time" className="text-xs" value={d.closeTime} onChange={(e) => updateDay(dayOfWeek, { closeTime: e.target.value })} />
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="mt-1 w-full text-xs" onClick={() => removeDay(dayOfWeek)}>
                    Unconfigure
                  </Button>
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-600">{d.isClosed ? 'Closed' : timeRange(d.openTime, d.closeTime) || 'Incomplete'}</p>
              )}
            </div>
          );
        })}
      </div>
      {canManage && (
        <Button size="sm" className="mt-2" onClick={() => void saveWeek()} disabled={savingWeek || !weekCanSave}>
          {savingWeek ? 'Saving…' : 'Save weekly pattern'}
        </Button>
      )}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Date-specific exceptions</h3>
      <p className="mt-1 text-xs text-slate-500">
        A known closure, a one-off change to the counter's hours for a single date — overrides the weekly pattern for
        that date only.
      </p>
      {exceptions.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No exceptions configured.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs">
              <span>
                <strong>{e.date}</strong> — {HUB_HOURS_EXCEPTION_STATUS_LABELS[e.status]}
                {e.status === 'MODIFIED' && timeRange(e.openTime, e.closeTime) ? ` (${timeRange(e.openTime, e.closeTime)})` : ''}
                {e.reason ? ` — ${e.reason}` : ''}
              </span>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => void removeException(e.id)}>Remove</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-5">
            <Input
              type="date"
              value={newException.date}
              onChange={(e) => setNewException({ ...newException, date: e.target.value })}
            />
            <Select
              value={newException.status}
              onChange={(e) => setNewException({ ...newException, status: e.target.value as HubHoursExceptionStatus })}
            >
              {HUB_HOURS_EXCEPTION_STATUSES.map((s) => (
                <option key={s} value={s}>{HUB_HOURS_EXCEPTION_STATUS_LABELS[s]}</option>
              ))}
            </Select>
            {newException.status === 'MODIFIED' && (
              <>
                <Input
                  type="time"
                  value={newException.openTime}
                  onChange={(e) => setNewException({ ...newException, openTime: e.target.value })}
                />
                <Input
                  type="time"
                  value={newException.closeTime}
                  onChange={(e) => setNewException({ ...newException, closeTime: e.target.value })}
                />
              </>
            )}
            <Textarea
              className={newException.status === 'MODIFIED' ? '' : 'sm:col-span-4'}
              placeholder="Reason (optional — ops' own words, never invented here)"
              value={newException.reason}
              onChange={(e) => setNewException({ ...newException, reason: e.target.value })}
              rows={1}
            />
          </div>
          <Button size="sm" className="mt-2" onClick={() => void addException()} disabled={addingException || !exceptionValid}>
            {addingException ? 'Adding…' : 'Add exception'}
          </Button>
        </>
      )}
    </div>
  );
}
