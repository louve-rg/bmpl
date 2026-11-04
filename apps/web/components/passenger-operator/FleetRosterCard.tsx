'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, Field, Input, Spinner, Textarea } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { affiliationView, settledLabel, type ProviderAffiliationRow } from '../../lib/passenger-fleet';

interface DriverDirectoryRow {
  id: string;
  displayName: string;
  homeDistrict?: string | null;
  availability?: string;
  isActive: boolean;
}

/**
 * The operator's fleet roster — the seat reserved since this card first
 * shipped, now filled by the mutual-consent affiliation API (BMPL-39).
 *
 * MUTUAL CONSENT, made visible: an invitation the operator sent shows as
 * exactly that — 'Invite sent' is never 'driver added', and the row says it is
 * waiting on the driver. A driver's join request is answerable here (approve /
 * decline); the operator's own invitation offers only withdrawal — the
 * operator can never answer their own ask, and the server refuses it in plain
 * words if the UI is ever wrong. Removing a driver is unilateral by design;
 * departures already assigned are unaffected and the copy says so.
 *
 * Deliberately absent: commissions, employment terms, payment rules — the
 * affiliation row is terms-free, which is why answering an existing ask
 * counts as consenting to the same thing.
 */
export function FleetRosterCard() {
  const [rows, setRows] = useState<ProviderAffiliationRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.get<ProviderAffiliationRow[]>('/passenger/provider/affiliations'));
      setForbidden(false);
    } catch (e) {
      // Role not APPROVED yet — the dashboard banner already explains.
      if ((e as ApiError).status === 403) setForbidden(true);
      else setErr(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (forbidden) return null;
  if (!rows && !err) {
    return (
      <UiCard className="p-4 sm:p-6">
        <h2 className="bmpl-eyebrow">Fleet roster</h2>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </UiCard>
    );
  }

  async function act(id: string, verb: 'approve' | 'decline' | 'withdraw' | 'end') {
    setBusyId(id);
    setErr(null);
    try {
      await api.post(`/passenger/provider/affiliations/${id}/${verb}`, {});
      setConfirmEndId(null);
      await reload();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const roster = rows?.filter((r) => affiliationView(r, 'PROVIDER').kind === 'active') ?? [];
  const requests = rows?.filter((r) => affiliationView(r, 'PROVIDER').kind === 'answer') ?? [];
  const invites = rows?.filter((r) => affiliationView(r, 'PROVIDER').kind === 'awaiting') ?? [];
  const settled = rows?.filter((r) => affiliationView(r, 'PROVIDER').kind === 'settled') ?? [];

  return (
    <UiCard className="p-4 sm:p-6">
      <h2 className="bmpl-eyebrow">Fleet roster</h2>
      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}

      {roster.length === 0 && (
        <p className="mt-3 text-sm text-[color:var(--bmpl-text-muted-strong)]">
          No drivers in your fleet yet. A driver joins only by answering your invitation, or by your approving their
          request — never by either side alone.
        </p>
      )}

      {roster.map((r) => (
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm text-belize-navy">{r.driver.displayName}</b>
              {r.driver.availability && <Badge tone={r.driver.availability === 'ONLINE' ? 'success' : 'neutral'}>{r.driver.availability}</Badge>}
              {!r.driver.isActive && <Badge tone="warning">Deactivated</Badge>}
            </div>
            {confirmEndId === r.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Removal is immediate; assigned departures are unaffected.</span>
                <Button type="button" size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => act(r.id, 'end')}>
                  Remove from fleet
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmEndId(null)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmEndId(r.id)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}

      {requests.map((r) => (
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-blue-300 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-belize-navy">
              <b>{r.driver.displayName}</b> asked to join your fleet.
            </p>
            <Badge tone="warning">Waiting on you</Badge>
          </div>
          {r.message && <p className="mt-1 text-sm text-slate-600">&ldquo;{r.message}&rdquo;</p>}
          <p className="mt-1 text-xs text-slate-500">Approving is what puts this driver in your fleet — nothing has happened yet.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={busyId === r.id} onClick={() => act(r.id, 'approve')}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, 'decline')}>
              Decline
            </Button>
          </div>
        </div>
      ))}

      {invites.map((r) => (
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-700">
              Invited <b>{r.driver.displayName}</b>.
            </p>
            <Badge tone="neutral">Waiting on the driver</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">An invitation is not a driver added — only the driver&rsquo;s acceptance joins them.</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busyId === r.id} onClick={() => act(r.id, 'withdraw')}>
            Withdraw invitation
          </Button>
        </div>
      ))}

      <InviteDriver onDone={reload} />

      {settled.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {settled.slice(0, 5).map((r) => (
            <li key={r.id}>
              {r.driver.displayName} — {settledLabel(r, 'PROVIDER')}
            </li>
          ))}
        </ul>
      )}
    </UiCard>
  );
}

/**
 * The operator's ask. It creates a PENDING invitation only — the driver joins
 * by accepting it. Finds the driver by name against the directory
 * (BMPL-COURIER-COMPLETION) — no raw driver id is ever shown or typed; the id
 * picked from a search result is carried silently into the invitation.
 */
function InviteDriver({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DriverDirectoryRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<DriverDirectoryRow | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (!open || picked || query.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      void api
        .get<DriverDirectoryRow[]>(`/passenger/provider/affiliations/directory/drivers?q=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch((e) => setErr(errMessage(e)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, open, picked]);

  function reset() {
    setOpen(false);
    setQ('');
    setResults(null);
    setPicked(null);
    setMessage('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/provider/affiliations/invite', {
        driverProfileId: picked.id,
        message: message.trim() || undefined,
      });
      reset();
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>
        Invite a driver
      </Button>
    );
  }

  return (
    <form className="mt-3 space-y-3 rounded-bmpl-md border border-slate-200 p-3" onSubmit={submit}>
      {err && <Alert tone="error">{err}</Alert>}

      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-bmpl-md border border-slate-200 bg-slate-50 p-2 text-sm">
          <span>
            Inviting <b>{picked.displayName}</b>
            {picked.homeDistrict && <span className="text-slate-500"> — {picked.homeDistrict}</span>}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Field label="Driver name" htmlFor="fleetInvQuery" hint="Search by display name — at least 2 characters.">
            <Input id="fleetInvQuery" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Alex Fleet" />
          </Field>
          {q.trim().length >= 2 && (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {searching ? (
                <p className="text-xs text-slate-500">Searching…</p>
              ) : results && results.length > 0 ? (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="block w-full rounded-bmpl-md border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => setPicked(r)}
                  >
                    <b>{r.displayName}</b>
                    {r.homeDistrict && <span className="text-slate-500"> — {r.homeDistrict}</span>}
                  </button>
                ))
              ) : results ? (
                <p className="text-xs text-slate-500">No matching independent drivers found.</p>
              ) : null}
            </div>
          )}
        </>
      )}

      <Field label="Message" htmlFor="fleetInvMessage" hint="Optional — the driver sees this with your invitation.">
        <Textarea id="fleetInvMessage" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">This sends an invitation the driver must accept — it does not add them to your fleet.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !picked}>
          Send invitation
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
