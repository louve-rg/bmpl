'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Input, Select, Spinner, Textarea } from '../ui';
import { operatingStatusLabel } from '../../lib/shipping-provider';

/**
 * Whether THIS route runs on a given day — the self-service half of
 * BMPL-186/MDF-526 item 4. Ported from `apps/admin`'s
 * `logistics/routes/schedule-editor.tsx` rather than re-derived: "same
 * schema whether the caller is the carrier or admin — one rule, not two
 * that could disagree" (`setRouteWeeklyScheduleSchema`'s own doc comment).
 * apps/admin and apps/web are separate Next apps with no shared component
 * import, so this is a deliberate, behavior-preserving port, not a parallel
 * reimplementation — same fields, same endpoints shape, same defaults.
 *
 * MDF-528: owner ruling was "allow" — these controls stay exactly as built.
 * The one thing the ruling added is the two disclosure lines below: marking
 * a day or a date NOT_OPERATING feeds the pre-existing multimodal planner
 * and removes this route from customer quotes on that day/date (no price
 * field is touched; the effect is through route selection). A carrier who
 * does not know that can suppress its own work by accident, so it is said
 * next to the controls that cause it, not in a help page.
 *
 * MDF-528 (Pam's guard, 807e22eb): none of the three writes below is ever
 * refused for this reason — a schedule change always succeeds, then reports
 * `affectedAcceptedLegs`, the already-accepted legs that now sit on a closed
 * date. `removeScheduleException` can cause this too (deleting an OPERATING
 * override can reinstate a NOT_OPERATING weekly default underneath it), so
 * all three paths capture and surface it, not just the two obvious writes.
 * Those legs are never blocked — Pam exempted an accepted leg from the
 * not-operating departure gate specifically so a closed day can never strand
 * committed work — and `CollisionNotice` says that explicitly, so a carrier
 * reads this as "here is what changed," not "something is now broken."
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_OPTIONS = ['OPERATING', 'REDUCED', 'NOT_OPERATING'] as const;
type Status = (typeof STATUS_OPTIONS)[number];

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

/** An already-accepted leg that a schedule write just left sitting on a closed date. */
interface AffectedAcceptedLeg {
  legId: string;
  shipmentId: string;
  reference: string;
  scheduledDepartureAt: string | null;
}

interface ScheduleWriteResult {
  affectedAcceptedLegs?: AffectedAcceptedLeg[];
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
  const [affectedLegs, setAffectedLegs] = useState<AffectedAcceptedLeg[]>([]);

  const load = useCallback(async () => {
    try {
      const s = await api.get<RouteSchedule>(`/shipping/provider/routes/${routeId}/schedule`);
      setDays(fullWeek(s.days));
      setExceptions(s.exceptions);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? "Could not load this route's schedule.");
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
      const res = await api.put<ScheduleWriteResult>(`/shipping/provider/routes/${routeId}/schedule`, {
        days: days.map((d) => ({ dayOfWeek: d.dayOfWeek, status: d.status, note: d.note || undefined })),
      });
      setAffectedLegs(res.affectedAcceptedLegs ?? []);
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
      const res = await api.post<ScheduleWriteResult>(`/shipping/provider/routes/${routeId}/schedule/exceptions`, {
        date: newException.date,
        status: newException.status,
        reason: newException.reason || undefined,
      });
      setAffectedLegs(res.affectedAcceptedLegs ?? []);
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
      const res = await api.del<ScheduleWriteResult>(`/shipping/provider/routes/${routeId}/schedule/exceptions/${id}`);
      setAffectedLegs(res.affectedAcceptedLegs ?? []);
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
      {err && (
        <Alert tone="warning" className="mb-3">
          {err}
        </Alert>
      )}

      {affectedLegs.length > 0 && <CollisionNotice legs={affectedLegs} />}

      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly pattern</h3>
      <p className="mt-1 text-xs text-slate-500">A day with no exception below follows this pattern. Absent entirely, a route is treated as operating.</p>
      <Alert tone="warning" className="mt-2">
        Marking a day "Not operating" takes this route out of customer quotes on that day of the week — you would be turning off your
        own availability, not just labeling a calendar.
      </Alert>
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
                <option key={s} value={s}>
                  {operatingStatusLabel(s)}
                </option>
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
      <p className="mt-1 text-xs text-slate-500">A known future closure, a holiday you observe, a one-off reduced run — overrides the weekly pattern for that date only.</p>
      <Alert tone="warning" className="mt-2">
        Adding a "Not operating" exception takes this route out of customer quotes on that date.
      </Alert>
      {exceptions.length === 0 ? (
        <p className="mt-2 text-xs text-[color:var(--bmpl-text-muted-strong)]">No exceptions configured.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs">
              <span>
                <strong>{e.date}</strong> — {operatingStatusLabel(e.status)}
                {e.reason ? ` (${e.reason})` : ''}
              </span>
              <Button variant="outline" size="sm" onClick={() => void removeException(e.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <Input type="date" value={newException.date} onChange={(e) => setNewException({ ...newException, date: e.target.value })} />
        <Select value={newException.status} onChange={(e) => setNewException({ ...newException, status: e.target.value as Status })}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {operatingStatusLabel(s)}
            </option>
          ))}
        </Select>
        <Textarea
          className="sm:col-span-2"
          placeholder="Reason (optional, your own words)"
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

/**
 * Shown after a successful schedule write that left an already-accepted leg
 * sitting on a now-closed date. Reads as a consequence of a save that
 * worked, not an error -- the write is never refused for this reason (Pam's
 * guard, MDF-528) -- and says the reassuring true thing explicitly: none of
 * these legs is blocked. Identifies each leg the way a human reads one, by
 * `reference` and its own departure date, never by `legId` or `shipmentId`.
 */
function CollisionNotice({ legs }: { legs: AffectedAcceptedLeg[] }) {
  return (
    <Alert tone="warning" className="mb-3">
      <p className="font-semibold">This closed a date you have already accepted work on.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {legs.map((l) => (
          <li key={l.legId}>
            {l.reference}
            {l.scheduledDepartureAt ? ` — departing ${new Date(l.scheduledDepartureAt).toLocaleString()}` : ''}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        These legs are not blocked — a closed day never strands work you already accepted. You can still depart and arrive them
        normally.
      </p>
    </Alert>
  );
}
