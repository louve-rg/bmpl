'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner } from '../../../../components/ui';

/**
 * Operating one shipment.
 *
 * Everything an operator can do to a parcel in flight, in the order the parcel
 * moves: depart, arrive, hand over, or flag a problem. The controls shown are
 * the ones the CURRENT state actually allows — a "Depart" button on a leg the
 * parcel has not reached yet is an invitation to a 400 and a confused phone call.
 *
 * Nothing here bypasses verification. The handoff still needs the code the
 * receiving party holds; this screen is a keypad, not an override.
 */

interface Leg {
  id: string;
  sequence: number;
  kind: 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE';
  mode: string;
  modeLabel: string;
  status: string;
  description: string | null;
  carrier: string | null;
  carrierBookingRef: string | null;
  scheduleNote: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  handoffReceivedByName: string | null;
  exceptionReason: string | null;
  originHub: { name: string } | null;
  destinationHub: { name: string } | null;
}

interface Custody {
  id: string;
  fromHolder: string | null;
  toHolder: string;
  actorLabel: string | null;
  note: string | null;
  occurredAt: string;
}

interface Shipment {
  id: string;
  reference: string;
  serviceLabel: string;
  status: string;
  statusLabel: string;
  isTest: boolean;
  endsAtHub: boolean;
  quotedTotalMinor: number;
  explanation: string | null;
  exceptionReason: string | null;
  cancelledAt: string | null;
  origin: { name: string | null; address: string | null; city: string | null; district: string | null };
  destination: { name: string | null; address: string | null; city: string | null; district: string | null };
  legs: Leg[];
  custody: Custody[];
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null;

/**
 * Which controls this leg's state allows.
 *
 * A line-haul is operated by hand because no BML driver is on it. A courier leg
 * is worked in the driver app, so an operator only sees it — with the exception
 * of flagging a problem, which anyone in operations may need to do at any time.
 */
function controlsFor(leg: Leg): { depart: boolean; arrive: boolean; handoff: boolean } {
  const live = leg.status === 'READY' || leg.status === 'IN_PROGRESS';
  if (leg.kind !== 'LINE_HAUL' || !live) return { depart: false, arrive: false, handoff: false };
  return {
    depart: leg.departedAt == null,
    arrive: leg.departedAt != null && leg.arrivedAt == null,
    handoff: leg.status === 'IN_PROGRESS',
  };
}

export default function ShipmentOpsPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(String(params.reference ?? ''));

  const [s, setS] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Record<string, { pin: string; who: string }>>({});

  const load = useCallback(async () => {
    try {
      setS(await api.get<Shipment>(`/admin/logistics/shipments/${encodeURIComponent(reference)}`));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load that shipment.');
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(legId: string, path: string, body: object = {}) {
    setBusy(`${legId}:${path}`);
    setErr(null);
    try {
      await api.post(`/admin/logistics/legs/${legId}/${path}`, body);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'That action was refused.');
    } finally {
      setBusy(null);
    }
  }

  async function flagException(legId: string) {
    const reason = window.prompt('What went wrong? The customer sees this.')?.trim();
    if (!reason || reason.length < 4) return;
    await act(legId, 'exception', { reason });
  }

  async function recordCollection() {
    if (!s) return;
    const collectedByName = window.prompt('Who collected the parcel?')?.trim();
    if (!collectedByName || collectedByName.length < 2) return;
    setBusy('collect');
    try {
      await api.post(`/admin/logistics/shipments/${s.id}/collect`, { collectedByName });
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not record that collection.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], reference)}
        title={reference}
        description={s ? `${s.serviceLabel} · ${s.statusLabel}` : undefined}
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}

      {s && (
        <div className="space-y-4">
          {s.exceptionReason && (
            <Alert tone="warning" title="This shipment needs attention">
              {s.exceptionReason}
            </Alert>
          )}

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.status === 'EXCEPTION' ? 'warning' : 'info'}>{s.statusLabel}</Badge>
                  <Badge tone="neutral">{s.serviceLabel}</Badge>
                  {s.isTest && <Badge tone="neutral">Simulation</Badge>}
                </div>
                <p className="mt-2 break-words text-sm text-slate-600">{s.explanation}</p>
              </div>
              <p className="shrink-0 text-lg font-bold tabular-nums text-slate-900">
                ${(s.quotedTotalMinor / 100).toFixed(2)}
              </p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['From', s.origin],
                  ['To', s.destination],
                ] as const
              ).map(([label, end]) => (
                <div key={label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-0.5 break-words text-sm text-slate-800">{end.name ?? '—'}</p>
                  {end.address && <p className="break-words text-sm text-slate-600">{end.address}</p>}
                  <p className="text-sm text-slate-500">
                    {[end.city, end.district?.replace(/_/g, ' ')].filter(Boolean).join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Ready to collect: the one thing no leg transition can close out. */}
          {s.status === 'AWAITING_COLLECTION' && (
            <Card className="border-emerald-300 bg-emerald-50/50 p-4">
              <p className="text-sm font-semibold text-emerald-900">Waiting to be collected</p>
              <p className="mt-1 text-sm text-emerald-800">
                Record the collection when the recipient picks it up. Nothing else can close this shipment.
              </p>
              <Button onClick={recordCollection} disabled={busy === 'collect'} className="mt-3">
                {busy === 'collect' ? 'Recording…' : 'Record collection'}
              </Button>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Legs</h2>
            <ol className="mt-3 space-y-3">
              {s.legs.map((leg) => {
                const c = controlsFor(leg);
                const h = handoff[leg.id] ?? { pin: '', who: '' };
                return (
                  <li key={leg.id} className="rounded-bmpl-md border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-slate-900">
                          {leg.sequence}. {leg.description ?? `${leg.modeLabel} leg`}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {leg.kind.replace(/_/g, ' ').toLowerCase()} · {leg.modeLabel}
                          {leg.carrier ? ` · ${leg.carrier}` : ''}
                          {leg.carrierBookingRef ? ` · ref ${leg.carrierBookingRef}` : ''}
                          {leg.scheduleNote ? ` · ${leg.scheduleNote}` : ''}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                          {when(leg.departedAt) && <span>Departed {when(leg.departedAt)}</span>}
                          {when(leg.arrivedAt) && <span>Arrived {when(leg.arrivedAt)}</span>}
                          {when(leg.completedAt) && <span>Handed over {when(leg.completedAt)}</span>}
                          {leg.handoffReceivedByName && <span>Taken by {leg.handoffReceivedByName}</span>}
                        </div>
                        {leg.exceptionReason && (
                          <p className="mt-1 break-words text-xs font-medium text-amber-800">{leg.exceptionReason}</p>
                        )}
                      </div>
                      <Badge tone={leg.status === 'COMPLETED' ? 'success' : leg.status === 'EXCEPTION' ? 'warning' : 'info'}>
                        {leg.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>

                    {(c.depart || c.arrive || c.handoff) && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <div className="flex flex-wrap gap-2">
                          {c.depart && (
                            <Button variant="outline" disabled={busy != null} onClick={() => void act(leg.id, 'depart')}>
                              Mark departed
                            </Button>
                          )}
                          {c.arrive && (
                            <Button variant="outline" disabled={busy != null} onClick={() => void act(leg.id, 'arrive')}>
                              Mark arrived
                            </Button>
                          )}
                        </div>

                        {c.handoff && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <Field label="Handover code" hint="Held by the receiving terminal.">
                              <Input
                                value={h.pin}
                                onChange={(e) => setHandoff({ ...handoff, [leg.id]: { ...h, pin: e.target.value } })}
                                inputMode="numeric"
                                className="w-28"
                                placeholder="0000"
                              />
                            </Field>
                            <Field label="Received by">
                              <Input
                                value={h.who}
                                onChange={(e) => setHandoff({ ...handoff, [leg.id]: { ...h, who: e.target.value } })}
                                placeholder="Counter staff name"
                              />
                            </Field>
                            <Button
                              disabled={busy != null || h.pin.length < 4 || h.who.trim().length < 2}
                              onClick={() => void act(leg.id, 'handoff', { pin: h.pin.trim(), receivedByName: h.who.trim() })}
                            >
                              Confirm handover
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {leg.status !== 'COMPLETED' && leg.status !== 'CANCELLED' && leg.status !== 'EXCEPTION' && (
                      <button
                        onClick={() => void flagException(leg.id)}
                        className="mt-2 text-xs font-medium text-amber-700 hover:underline"
                      >
                        Report a problem with this leg
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Chain of custody</h2>
            <p className="mt-0.5 text-xs text-slate-500">Append-only. Nothing on this screen can rewrite it.</p>
            <ul className="mt-3 space-y-2">
              {s.custody.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {c.fromHolder ? `${c.fromHolder.toLowerCase()} → ` : ''}
                    {c.toHolder.toLowerCase()}
                  </span>
                  {c.actorLabel && <span>{c.actorLabel}</span>}
                  {c.note && <span className="text-slate-500">{c.note}</span>}
                  <span className="text-slate-400">{when(c.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
