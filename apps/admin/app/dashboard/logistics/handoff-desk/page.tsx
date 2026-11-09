'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, Field, Input, LoadingRow, PageHeader, Select } from '../../../../components/ui';

/**
 * The handoff desk: what a terminal should be expecting.
 *
 * The person behind a counter needs one answer — "what is coming to me, who is
 * bringing it, and is it here yet" — without opening shipments one by one. This
 * screen is that list, read straight from the legs inbound to the chosen
 * terminal. It shows only what the API asserts: it does not know departure
 * timetables and it does not track vehicles live, so a parcel is either
 * "arrived" or "on its way", nothing more precise.
 *
 * TERM-5-UI, per leg kind:
 *   - FIRST_MILE: no reveal — an ENTRY field. Staff used to reveal this leg's
 *     own code and read it to the courier verbally, which made the handoff's
 *     "proof" circular: whoever staff told would pass, correct courier or
 *     not (ShipmentService.revealHandoffPin's own doc comment names this as
 *     the original leak). The courier now self-reveals their own code on
 *     their own device (ShipmentDriverService.revealOwnCode) and presents it
 *     at the counter; staff type it in here and submit it through
 *     `completeLeg` with `presentedByAssignedCourier: true` — never a courier
 *     user id the browser looked up (expectedAtHub deliberately never
 *     exposes one, BMPL-247's same minimum-identity line that already
 *     withholds the courier's phone number below). The server derives who
 *     "the assigned courier" is from the leg itself and refuses a code that
 *     doesn't match, so staff learning a code and vouching for whoever
 *     walked up is no longer sufficient — the courier has to have actually
 *     held the device that revealed it.
 *   - LINE_HAUL: unchanged. No courier exists in this flow (a carrier runs
 *     it, not a BML driver), so staff being both revealer and submitter is
 *     correct here, not a leak — there is no second party to separate it
 *     from. Keeps the pre-existing GET handoff-pin reveal exactly as it was.
 *   - LAST_MILE: a new release-to-courier entry. `confirmPickup` (the
 *     courier's own self-submit path) never took a code for this leg kind at
 *     all, so this closes a verification gap that previously had nothing on
 *     either side of it, staff or courier.
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
  // BMPL-247: the API deliberately no longer returns the courier's personal
  // phone here — logistics.read is a platform-wide, cross-hub permission
  // with no scoping to "staff at this terminal", and the owner ruled that
  // number private by default. broughtBy (display name) is the minimum
  // operational identity the desk needs.
  broughtBy: string;
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

  // FIRST_MILE: the entry field the courier's presented code goes into.
  const [handoffForms, setHandoffForms] = useState<Record<string, { pin: string; receivedByName: string }>>({});
  const [handoffErr, setHandoffErr] = useState<Record<string, string>>({});
  const [handoffBusy, setHandoffBusy] = useState<string | null>(null);

  // LAST_MILE: the entry field for a courier collecting from this terminal.
  const [releaseForms, setReleaseForms] = useState<Record<string, string>>({});
  const [releaseErr, setReleaseErr] = useState<Record<string, string>>({});
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null);

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
    // Revealed codes, and anything mid-typed into an entry field, never
    // survive a reload or a change of terminal.
    setPins({});
    setPinErr({});
    setHandoffForms({});
    setHandoffErr({});
    setReleaseForms({});
    setReleaseErr({});
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

  /**
   * FIRST_MILE: staff submit the code the courier presented, having read it
   * off their own device. `presentedByAssignedCourier: true` tells the
   * server to resolve who "the assigned courier" is from the leg itself —
   * this screen never learns or sends a courier's user id.
   */
  async function submitHandoff(legId: string) {
    const form = handoffForms[legId] ?? { pin: '', receivedByName: '' };
    const pin = form.pin.trim();
    const receivedByName = form.receivedByName.trim();
    if (!pin || !receivedByName) {
      setHandoffErr((prev) => ({ ...prev, [legId]: 'Enter the code the courier presented and who is receiving it.' }));
      return;
    }
    setHandoffBusy(legId);
    setHandoffErr((prev) => {
      const { [legId]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      await api.post(`/admin/logistics/legs/${legId}/handoff`, { pin, receivedByName, presentedByAssignedCourier: true });
      setHandoffForms((prev) => {
        const { [legId]: _drop, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (e) {
      // Includes the lockout and "no courier assigned" refusals — the
      // server's own words, same as every other PIN failure on this screen.
      setHandoffErr((prev) => ({ ...prev, [legId]: (e as ApiError).message ?? 'Could not record this handoff.' }));
    } finally {
      setHandoffBusy(null);
    }
  }

  /**
   * LAST_MILE: staff release a parcel to the courier presenting their own
   * terminal code. No courier id to send at all — this route only ever
   * exists for a leg that already has an assigned courier, so the server
   * derives the presenter from the leg's own assignment unconditionally.
   */
  async function submitRelease(legId: string) {
    const pin = (releaseForms[legId] ?? '').trim();
    if (!pin) {
      setReleaseErr((prev) => ({ ...prev, [legId]: 'Enter the code the courier presented.' }));
      return;
    }
    setReleaseBusy(legId);
    setReleaseErr((prev) => {
      const { [legId]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      await api.post(`/admin/logistics/legs/${legId}/release-to-courier`, { pin });
      setReleaseForms((prev) => {
        const { [legId]: _drop, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (e) {
      setReleaseErr((prev) => ({ ...prev, [legId]: (e as ApiError).message ?? 'Could not release this parcel.' }));
    } finally {
      setReleaseBusy(null);
    }
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

          {!hubs && <LoadingRow className="mt-6" label="Loading terminals…" />}

          {hubs && hubs.length > 0 && !hubId && (
            <p className="mt-6 text-sm text-[color:var(--bmpl-text-muted)]">Choose a terminal to see what it is expecting.</p>
          )}

          {loading && (
            <LoadingRow className="mt-6" />
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
                          className="font-mono text-sm font-semibold text-[color:var(--bmpl-link)] hover:underline"
                        >
                          {r.reference}
                        </Link>
                        <Badge tone={r.arrived ? 'success' : 'info'}>{r.arrived ? 'Arrived' : 'On its way'}</Badge>
                        <Badge tone="neutral">{r.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                      </div>
                      <p className="mt-1 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{r.parcel}</p>
                      <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted-strong)]">From {r.from} · brought by {r.broughtBy}</p>
                      {r.forRecipient && (
                        <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-muted)]">For {r.forRecipient}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-xs text-[color:var(--bmpl-text-muted)]">
                      {when(r.departedAt) && <p>Departed {when(r.departedAt)}</p>}
                      {when(r.arrivedAt) && <p>Arrived {when(r.arrivedAt)}</p>}
                    </div>
                  </div>

                  {/* LINE_HAUL only: no courier exists in this flow, so staff
                      revealing and submitting the same code is correct, not a
                      leak. Unchanged by TERM-5-UI. */}
                  {r.kind === 'LINE_HAUL' && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      {pins[r.legId] ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="text-[color:var(--bmpl-text-muted-strong)]">Handoff code</span>
                          <span className="font-mono text-base font-bold tracking-widest text-[color:var(--bmpl-text)]">
                            {pins[r.legId]?.handoffPin ?? '—'}
                          </span>
                          {pins[r.legId]?.handoffVerificationStatus && (
                            <span className="text-xs text-[color:var(--bmpl-text-muted)]">
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
                            className="text-xs font-medium text-[color:var(--bmpl-text-muted)] hover:underline"
                          >
                            Hide
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void revealPin(r.legId)}
                          disabled={pinBusy === r.legId}
                          className="text-xs font-medium text-[color:var(--bmpl-link)] hover:underline disabled:opacity-50"
                        >
                          {pinBusy === r.legId ? 'Revealing…' : 'Reveal handoff code'}
                        </button>
                      )}
                      {pinErr[r.legId] && (
                        <p className="mt-1 break-words text-xs font-medium text-amber-800">{pinErr[r.legId]}</p>
                      )}
                    </div>
                  )}

                  {/* FIRST_MILE: an entry field, not a reveal — the courier
                      read this code off their own device and presents it
                      here. Staff never learn it ahead of time. */}
                  {r.kind === 'FIRST_MILE' && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      <p className="text-xs text-[color:var(--bmpl-text-muted)]">
                        Ask the courier for the code on their own device, and who at the counter is taking the parcel.
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Field label="Code presented" htmlFor={`handoff-pin-${r.legId}`}>
                          <Input
                            id={`handoff-pin-${r.legId}`}
                            value={handoffForms[r.legId]?.pin ?? ''}
                            onChange={(e) =>
                              setHandoffForms((prev) => ({
                                ...prev,
                                [r.legId]: { ...(prev[r.legId] ?? { pin: '', receivedByName: '' }), pin: e.target.value },
                              }))
                            }
                            className="w-28 font-mono"
                            placeholder="1234"
                          />
                        </Field>
                        <Field label="Received by" htmlFor={`handoff-who-${r.legId}`}>
                          <Input
                            id={`handoff-who-${r.legId}`}
                            value={handoffForms[r.legId]?.receivedByName ?? ''}
                            onChange={(e) =>
                              setHandoffForms((prev) => ({
                                ...prev,
                                [r.legId]: { ...(prev[r.legId] ?? { pin: '', receivedByName: '' }), receivedByName: e.target.value },
                              }))
                            }
                            placeholder="Counter staff name"
                          />
                        </Field>
                        <Button onClick={() => void submitHandoff(r.legId)} disabled={handoffBusy === r.legId}>
                          {handoffBusy === r.legId ? 'Recording…' : 'Record handoff'}
                        </Button>
                      </div>
                      {handoffErr[r.legId] && (
                        <p className="mt-1 break-words text-xs font-medium text-amber-800">{handoffErr[r.legId]}</p>
                      )}
                    </div>
                  )}

                  {/* LAST_MILE: confirmPickup (the courier's own self-submit
                      path) never took a code for this leg kind at all — this
                      is its first verification, staff- or courier-side. */}
                  {r.kind === 'LAST_MILE' && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      <p className="text-xs text-[color:var(--bmpl-text-muted)]">
                        Ask the courier collecting this parcel for the code on their own device.
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Field label="Code presented" htmlFor={`release-pin-${r.legId}`}>
                          <Input
                            id={`release-pin-${r.legId}`}
                            value={releaseForms[r.legId] ?? ''}
                            onChange={(e) => setReleaseForms((prev) => ({ ...prev, [r.legId]: e.target.value }))}
                            className="w-28 font-mono"
                            placeholder="1234"
                          />
                        </Field>
                        <Button onClick={() => void submitRelease(r.legId)} disabled={releaseBusy === r.legId}>
                          {releaseBusy === r.legId ? 'Releasing…' : 'Release to courier'}
                        </Button>
                      </div>
                      {releaseErr[r.legId] && (
                        <p className="mt-1 break-words text-xs font-medium text-amber-800">{releaseErr[r.legId]}</p>
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
