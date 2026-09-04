'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, Field, PageHeader, Select, Spinner } from '../../../../components/ui';

/**
 * The handoff desk: what a terminal should be expecting.
 *
 * The person behind a counter needs one answer — "what is coming to me, who is
 * bringing it, and is it here yet" — without opening shipments one by one. This
 * screen is that list, read straight from the legs inbound to the chosen
 * terminal. It shows only what the API asserts: it does not know departure
 * timetables and it does not track vehicles live, so a parcel is either
 * "arrived" or "on its way", nothing more precise.
 */

interface HubOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface ExpectedLeg {
  legId: string;
  reference: string;
  kind: 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE';
  broughtBy: string;
  contactPhone: string | null;
  from: string;
  parcel: string;
  arrived: boolean;
  departedAt: string | null;
  arrivedAt: string | null;
  forRecipient: string | null;
}

/**
 * A deliberately revealed handoff code. Held only in component state, only
 * after an explicit click, and dropped on every reload — each reveal is
 * audited server-side, so one action means one reveal, never a prefetch.
 */
interface RevealedPin {
  handoffPin: string | null;
  handoffPinAttempts: number;
  handoffVerificationStatus: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null;

export default function HandoffDeskPage() {
  const [hubs, setHubs] = useState<HubOption[] | null>(null);
  const [hubId, setHubId] = useState('');
  const [rows, setRows] = useState<ExpectedLeg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<string, RevealedPin>>({});
  const [pinErr, setPinErr] = useState<Record<string, string>>({});
  const [pinBusy, setPinBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<HubOption[]>('/admin/logistics/hubs')
      .then((list) => {
        if (cancelled) return;
        setHubs(list);
        // A counter operator at the only terminal should not have to pick it.
        const only = list.length === 1 ? list[0] : undefined;
        if (only) setHubId(only.id);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr((e as ApiError).message ?? 'Could not load terminals.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!hubId) return;
    setLoading(true);
    // Revealed codes never survive a reload or a change of terminal.
    setPins({});
    setPinErr({});
    try {
      setRows(await api.get<ExpectedLeg[]>(`/admin/logistics/hubs/${hubId}/expected`));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load what this terminal is expecting.');
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  async function revealPin(legId: string) {
    setPinBusy(legId);
    setPinErr((prev) => {
      const { [legId]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const pin = await api.get<RevealedPin>(`/admin/logistics/legs/${legId}/handoff-pin`);
      setPins((prev) => ({ ...prev, [legId]: pin }));
    } catch (e) {
      // The refusals are deliberate (permission split, assigned driver,
      // door-held code, finished leg) — show the server's own words.
      setPinErr((prev) => ({ ...prev, [legId]: (e as ApiError).message ?? 'Could not reveal the code.' }));
    } finally {
      setPinBusy(null);
    }
  }

  function hidePin(legId: string) {
    setPins((prev) => {
      const { [legId]: _drop, ...rest } = prev;
      return rest;
    });
  }

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const hub = hubs?.find((h) => h.id === hubId) ?? null;

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Handoff desk')}
        title="Handoff desk"
        description="Parcels inbound to a terminal: who is bringing each one, and whether it is here yet."
      />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}

      {hubs && hubs.length === 0 ? (
        // The normal state until operations configures the transport network —
        // not an error, and not something this screen can or should fill in.
        <EmptyState
          title="No terminals configured yet"
          description="The handoff desk lists what a terminal is expecting, so it needs a terminal to exist first. Terminals are created by operations as carriers come on board."
          action={<ButtonLink href="/dashboard/logistics/hubs" variant="outline">Manage terminals</ButtonLink>}
        />
      ) : (
        <>
          <Card className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Terminal" htmlFor="handoff-hub">
                <Select id="handoff-hub" value={hubId} onChange={(e) => setHubId(e.target.value)}>
                  <option value="">Choose a terminal…</option>
                  {(hubs ?? []).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.code} — {h.name}{h.isActive ? '' : ' (inactive)'}
                    </option>
                  ))}
                </Select>
              </Field>
              {hubId && (
                <Button onClick={() => void load()} variant="outline" disabled={loading}>
                  Refresh
                </Button>
              )}
            </div>
          </Card>

          {!hubs && (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading terminals…
            </div>
          )}

          {hubs && hubs.length > 0 && !hubId && (
            <p className="mt-6 text-sm text-slate-500">Choose a terminal to see what it is expecting.</p>
          )}

          {loading && (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading…
            </div>
          )}

          {!loading && hub && rows && rows.length === 0 && (
            <div className="mt-6">
              <EmptyState
                title={`Nothing expected at ${hub.name}`}
                description="No shipment currently has a leg inbound to this terminal. New work appears here as soon as a shipment is routed through it."
              />
            </div>
          )}

          {!loading && rows && rows.length > 0 && (
            <div className="mt-4 space-y-3">
              {rows.map((r) => (
                <Card key={r.legId} className={`p-4 ${r.arrived ? 'border-emerald-200 bg-emerald-50/40' : ''}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/logistics/${encodeURIComponent(r.reference)}`}
                          className="font-mono text-sm font-semibold text-belize-blue hover:underline"
                        >
                          {r.reference}
                        </Link>
                        <Badge tone={r.arrived ? 'success' : 'info'}>{r.arrived ? 'Arrived' : 'On its way'}</Badge>
                        <Badge tone="neutral">{r.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                      </div>
                      <p className="mt-1 break-words text-sm text-slate-700">{r.parcel}</p>
                      <p className="mt-0.5 break-words text-sm text-slate-600">
                        From {r.from} · brought by {r.broughtBy}
                        {r.contactPhone ? ` · ${r.contactPhone}` : ''}
                      </p>
                      {r.forRecipient && (
                        <p className="mt-0.5 text-xs text-slate-500">For {r.forRecipient}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      {when(r.departedAt) && <p>Departed {when(r.departedAt)}</p>}
                      {when(r.arrivedAt) && <p>Arrived {when(r.arrivedAt)}</p>}
                    </div>
                  </div>

                  {/* The code a desk verifies is revealed one deliberate click at
                      a time — every reveal is audited. A last-mile code belongs
                      to the recipient, not the desk, so those rows offer none. */}
                  {(r.kind === 'FIRST_MILE' || r.kind === 'LINE_HAUL') && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      {pins[r.legId] ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="text-slate-600">Handoff code</span>
                          <span className="font-mono text-base font-bold tracking-widest text-slate-900">
                            {pins[r.legId]?.handoffPin ?? '—'}
                          </span>
                          {pins[r.legId]?.handoffVerificationStatus && (
                            <span className="text-xs text-slate-500">
                              {pins[r.legId]?.handoffVerificationStatus?.toLowerCase()}
                            </span>
                          )}
                          {(pins[r.legId]?.handoffPinAttempts ?? 0) > 0 && (
                            <span className="text-xs font-medium text-amber-700">
                              {pins[r.legId]?.handoffPinAttempts} failed attempt{pins[r.legId]?.handoffPinAttempts === 1 ? '' : 's'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => hidePin(r.legId)}
                            className="text-xs font-medium text-slate-500 hover:underline"
                          >
                            Hide
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void revealPin(r.legId)}
                          disabled={pinBusy === r.legId}
                          className="text-xs font-medium text-belize-blue hover:underline disabled:opacity-50"
                        >
                          {pinBusy === r.legId ? 'Revealing…' : 'Reveal handoff code'}
                        </button>
                      )}
                      {pinErr[r.legId] && (
                        <p className="mt-1 break-words text-xs font-medium text-amber-800">{pinErr[r.legId]}</p>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
