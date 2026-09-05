'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, Field, Input, Spinner, Textarea } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { affiliationView, settledLabel, type ProviderAffiliationRow } from '../../lib/passenger-fleet';

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
export function FleetRosterCard({ providerProfileId }: { providerProfileId: string }) {
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
        <p className="mt-3 text-sm text-slate-600">
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
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-belize-blue/30 bg-belize-blue/5 p-3">
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

      <p className="mt-4 text-xs text-slate-500">
        Your operator ID: <code className="rounded bg-slate-100 px-1 py-0.5">{providerProfileId}</code> — share it with a
        driver who wants to request to join.
      </p>

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

/** The operator's ask. It creates a PENDING invitation only — the driver joins by accepting it. */
function InviteDriver({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/provider/affiliations/invite', {
        driverProfileId: driverId.trim(),
        message: message.trim() || undefined,
      });
      setOpen(false);
      setDriverId('');
      setMessage('');
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
      <Field
        label="Driver ID"
        htmlFor="fleetInvDriver"
        hint="Ask the driver for their driver ID — it's shown on their Passenger Dashboard."
      >
        <Input id="fleetInvDriver" value={driverId} onChange={(e) => setDriverId(e.target.value)} required />
      </Field>
      <Field label="Message" htmlFor="fleetInvMessage" hint="Optional — the driver sees this with your invitation.">
        <Textarea id="fleetInvMessage" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">This sends an invitation the driver must accept — it does not add them to your fleet.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !driverId.trim()}>
          Send invitation
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
