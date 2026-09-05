'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, Field, Input, Spinner, Textarea } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { affiliationView, settledLabel, type DriverAffiliationRow } from '../../lib/passenger-fleet';

/**
 * The driver's fleet membership — the seat reserved since this card first
 * shipped, now filled by the mutual-consent affiliation API (BMPL-39).
 *
 * MUTUAL CONSENT, made visible: every pending ask says which side is waiting
 * on whom. An operator's invitation is answerable here (accept / decline); the
 * driver's own request offers only withdrawal — the driver can never answer
 * their own ask, and the server refuses it in plain words if the UI is ever
 * wrong. Leaving a fleet is unilateral by design (consent creates the
 * relationship; either side may dissolve it) and departures already assigned
 * are unaffected — the copy says so rather than implying a negotiation.
 *
 * Deliberately absent: commissions, employment terms, payment rules. The
 * affiliation row is terms-free and that is load-bearing — it is why
 * answering an existing ask counts as consenting to the same thing.
 */
export function FleetCard({ driverProfileId }: { driverProfileId: string }) {
  const [rows, setRows] = useState<DriverAffiliationRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.get<DriverAffiliationRow[]>('/passenger/driver/affiliations'));
      setForbidden(false);
    } catch (e) {
      // Role not APPROVED yet: fleet membership is not in reach, and the
      // dashboard's status banner already explains where the application
      // stands — an error card here would just shout at an applicant.
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
        <h2 className="bmpl-eyebrow">Fleet</h2>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </UiCard>
    );
  }

  async function act(id: string, verb: 'accept' | 'decline' | 'withdraw' | 'end') {
    setBusyId(id);
    setErr(null);
    try {
      await api.post(`/passenger/driver/affiliations/${id}/${verb}`, {});
      setConfirmEndId(null);
      await reload();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const active = rows?.find((r) => affiliationView(r, 'DRIVER').kind === 'active');
  const invitations = rows?.filter((r) => affiliationView(r, 'DRIVER').kind === 'answer') ?? [];
  const asks = rows?.filter((r) => affiliationView(r, 'DRIVER').kind === 'awaiting') ?? [];
  const settled = rows?.filter((r) => affiliationView(r, 'DRIVER').kind === 'settled') ?? [];

  return (
    <UiCard className="p-4 sm:p-6">
      <h2 className="bmpl-eyebrow">Fleet</h2>
      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}

      {active ? (
        <div className="mt-3">
          <p className="text-sm text-belize-navy">
            You drive for <b>{active.provider.businessName}</b>
            {!active.provider.isActive && (
              <Badge tone="warning" className="ml-2">
                Operator suspended
              </Badge>
            )}
          </p>
          {confirmEndId === active.id ? (
            <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
              <p className="text-sm text-slate-600">
                Leaving takes effect immediately and needs no one&rsquo;s approval. Departures already assigned to you
                stay assigned.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="destructive" disabled={busyId === active.id} onClick={() => act(active.id, 'end')}>
                  Leave this fleet
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmEndId(null)}>
                  Stay
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setConfirmEndId(active.id)}>
              Leave fleet
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          Independent — you are not part of a fleet.
        </p>
      )}

      {invitations.map((r) => (
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-belize-blue/30 bg-belize-blue/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-belize-navy">
              <b>{r.provider.businessName}</b> invited you to join their fleet.
            </p>
            <Badge tone="warning">Waiting on you</Badge>
          </div>
          {r.message && <p className="mt-1 text-sm text-slate-600">&ldquo;{r.message}&rdquo;</p>}
          <p className="mt-1 text-xs text-slate-500">
            Nothing happens until you answer — accepting is what makes you part of this fleet.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={busyId === r.id} onClick={() => act(r.id, 'accept')}>
              Accept
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, 'decline')}>
              Decline
            </Button>
          </div>
        </div>
      ))}

      {asks.map((r) => (
        <div key={r.id} className="mt-3 rounded-bmpl-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-700">
              You asked to join <b>{r.provider.businessName}</b>.
            </p>
            <Badge tone="neutral">Waiting on the operator</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">You are not in this fleet unless the operator approves.</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busyId === r.id} onClick={() => act(r.id, 'withdraw')}>
            Withdraw request
          </Button>
        </div>
      ))}

      {!active && <RequestToJoin onDone={reload} />}

      <p className="mt-4 text-xs text-slate-500">
        Your driver ID: <code className="rounded bg-slate-100 px-1 py-0.5">{driverProfileId}</code> — share it with an
        operator who wants to invite you.
      </p>

      {settled.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {settled.slice(0, 5).map((r) => (
            <li key={r.id}>
              {r.provider.businessName} — {settledLabel(r, 'DRIVER')}
            </li>
          ))}
        </ul>
      )}
    </UiCard>
  );
}

/** The driver's ask. It creates a PENDING request only — joining happens when the operator approves. */
function RequestToJoin({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/driver/affiliations/request', {
        providerProfileId: providerId.trim(),
        message: message.trim() || undefined,
      });
      setOpen(false);
      setProviderId('');
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
        Request to join a fleet
      </Button>
    );
  }

  return (
    <form className="mt-3 space-y-3 rounded-bmpl-md border border-slate-200 p-3" onSubmit={submit}>
      {err && <Alert tone="error">{err}</Alert>}
      <Field
        label="Operator ID"
        htmlFor="fleetReqProvider"
        hint="Ask the operator for their operator ID — it's shown on their Operator Dashboard."
      >
        <Input id="fleetReqProvider" value={providerId} onChange={(e) => setProviderId(e.target.value)} required />
      </Field>
      <Field label="Message" htmlFor="fleetReqMessage" hint="Optional — the operator sees this with your request.">
        <Textarea id="fleetReqMessage" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">This sends a request the operator must approve — it does not join you to the fleet.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !providerId.trim()}>
          Send request
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
