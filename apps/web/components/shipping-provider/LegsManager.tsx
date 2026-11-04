'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { isPendingProposal, type ShippingProviderLeg } from '../../lib/shipping-provider';
import { ApprovalRequired } from './data';

/**
 * This organization's own transport legs (MDF-COURIER D2/D3, MDF-526
 * item 1-3). Discovery is by human-readable shipment reference — never a
 * database id — exactly the gap god named: "without it nothing else is
 * reachable." Every action here maps to a flag `providerLegOut` already
 * computes server-side (`canAccept`/`canReject`/`canDepart`/`canArrive`/
 * `canSchedule`); this never re-derives the state machine, it only reads it.
 */
export function LegsManager() {
  const [legs, setLegs] = useState<ShippingProviderLeg[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLegs(await api.get<ShippingProviderLeg[]>('/shipping/provider/legs'));
      setNotApproved(false);
      setErr(null);
    } catch (e) {
      if ((e as ApiError).status === 403) setNotApproved(true);
      else setErr(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (notApproved) return <ApprovalRequired />;

  const proposals = (legs ?? []).filter((l) => isPendingProposal(l));
  const active = (legs ?? []).filter((l) => !isPendingProposal(l));

  return (
    <div className="space-y-5">
      {err && <Alert tone="error">{err}</Alert>}

      {legs && legs.length === 0 && (
        <EmptyState title="No legs yet" description="A leg appears here once BML's admin console proposes your organization as its operator." />
      )}

      {proposals.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-belize-navy">Awaiting your answer</h2>
          <div className="space-y-3">
            {proposals.map((l) => (
              <LegCard key={l.id} leg={l} onChanged={reload} />
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-belize-navy">Accepted</h2>
          <div className="space-y-3">
            {active.map((l) => (
              <LegCard key={l.id} leg={l} onChanged={reload} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LegCard({ leg: l, onChanged }: { leg: ShippingProviderLeg; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [departureAt, setDepartureAt] = useState('');
  const [arrivalAt, setArrivalAt] = useState('');
  const [carrierName, setCarrierName] = useState(l.carrierName ?? '');
  const [carrierBookingRef, setCarrierBookingRef] = useState(l.carrierBookingRef ?? '');
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    setBusy('accept');
    setErr(null);
    try {
      await api.post(`/shipping/provider/legs/${l.id}/accept`, {});
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason) {
      setErr('A reason is required.');
      return;
    }
    setBusy('reject');
    setErr(null);
    try {
      await api.post(`/shipping/provider/legs/${l.id}/reject`, { reason });
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function depart() {
    setBusy('depart');
    setErr(null);
    try {
      await api.post(`/shipping/provider/legs/${l.id}/depart`, {
        carrierName: carrierName.trim() || undefined,
        carrierBookingRef: carrierBookingRef.trim() || undefined,
      });
      setDeparting(false);
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function arrive() {
    setBusy('arrive');
    setErr(null);
    try {
      await api.post(`/shipping/provider/legs/${l.id}/arrive`, {});
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitSchedule() {
    setBusy('schedule');
    setErr(null);
    try {
      await api.post(`/shipping/provider/legs/${l.id}/schedule`, {
        scheduledDepartureAt: departureAt || undefined,
        scheduledArrivalAt: arrivalAt || undefined,
      });
      setScheduling(false);
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">{l.reference}</b>
            <Badge tone="neutral">{l.status.replace(/_/g, ' ')}</Badge>
            <Badge tone="neutral">{l.modeLabel}</Badge>
            {l.isTest && <Badge tone="neutral">Simulation</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {l.from ? `${l.from.name}, ${l.from.city}` : '—'} → {l.to ? `${l.to.name}, ${l.to.city}` : '—'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {l.pieces} piece{l.pieces === 1 ? '' : 's'}
            {l.description ? ` · ${l.description}` : ''}
          </p>
          {(l.scheduledDepartureAt || l.scheduledArrivalAt) && (
            <p className="mt-0.5 text-xs text-slate-500">
              {l.scheduledDepartureAt && <>Scheduled departure {new Date(l.scheduledDepartureAt).toLocaleString()}</>}
              {l.scheduledDepartureAt && l.scheduledArrivalAt && ' · '}
              {l.scheduledArrivalAt && <>Scheduled arrival {new Date(l.scheduledArrivalAt).toLocaleString()}</>}
            </p>
          )}
          {l.departedAt && <p className="mt-0.5 text-xs text-emerald-700">Departed {new Date(l.departedAt).toLocaleString()}</p>}
          {l.arrivedAt && <p className="mt-0.5 text-xs text-emerald-700">Arrived {new Date(l.arrivedAt).toLocaleString()}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPendingProposal(l) && !rejecting && (
            <>
              <Button type="button" size="sm" disabled={busy != null} onClick={() => void accept()}>
                {busy === 'accept' ? 'Accepting…' : 'Accept'}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </>
          )}
          {l.canDepart && !departing && (
            <Button type="button" size="sm" onClick={() => setDeparting(true)}>
              Record departure
            </Button>
          )}
          {l.canArrive && (
            <Button type="button" size="sm" disabled={busy != null} onClick={() => void arrive()}>
              {busy === 'arrive' ? 'Recording…' : 'Record arrival'}
            </Button>
          )}
          {l.canSchedule && !scheduling && (
            <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(true)}>
              Set schedule
            </Button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
          <Field label="Reason — operations sees this" htmlFor={`${l.id}-reject`}>
            <Input id={`${l.id}-reject`} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy != null} onClick={() => void reject()}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject this leg'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {departing && (
        <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Carrier name" htmlFor={`${l.id}-carrierName`} hint="Optional">
              <Input id={`${l.id}-carrierName`} value={carrierName} onChange={(e) => setCarrierName(e.target.value)} />
            </Field>
            <Field label="Booking reference" htmlFor={`${l.id}-carrierRef`} hint="Optional">
              <Input id={`${l.id}-carrierRef`} value={carrierBookingRef} onChange={(e) => setCarrierBookingRef(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy != null} onClick={() => void depart()}>
              {busy === 'depart' ? 'Recording…' : 'Confirm departure'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDeparting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {scheduling && (
        <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Scheduled departure" htmlFor={`${l.id}-schedDep`} hint="Give either or both">
              <Input id={`${l.id}-schedDep`} type="datetime-local" value={departureAt} onChange={(e) => setDepartureAt(e.target.value)} />
            </Field>
            <Field label="Scheduled arrival" htmlFor={`${l.id}-schedArr`} hint="Must be after departure if both given">
              <Input id={`${l.id}-schedArr`} type="datetime-local" value={arrivalAt} onChange={(e) => setArrivalAt(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy != null || (!departureAt && !arrivalAt)} onClick={() => void submitSchedule()}>
              {busy === 'schedule' ? 'Saving…' : 'Save schedule'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}
    </UiCard>
  );
}
