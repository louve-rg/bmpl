'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { legScheduleSchema } from '@bmpl/validation';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { relativeTime } from '../../../../lib/notifications';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../../../components/ui';
import { ExceptionResolution } from '../../../../components/logistics/ExceptionResolution';
import { ExceptionRecovery } from '../../../../components/logistics/ExceptionRecovery';
import { LegAssignModal } from '../../../../components/logistics/LegAssignModal';
import { AddressMapPreview } from '../../../../components/maps/AddressMapPreview';
import type { MapPoint } from '../../../../lib/trip-map';

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
  /**
   * BMPL-346 — the only writer is `scheduleLeg()`, a real carrier-committed
   * time, never a guess. Line-haul only; null means no commitment recorded
   * yet, same meaning as every other not-yet-happened timestamp on this leg.
   */
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  /**
   * BMPL-178/352 (Edward req 2): the courier's own pickup evidence for THIS
   * leg. Optional — web and api deploy independently, so a required field
   * read unguarded is how a screen crashes on the API side lagging behind
   * a merge (BMPL-349); absence means nothing attached yet, same as empty.
   */
  pickupPhotoUrls?: string[];
  /**
   * MDF-500: the carrier ORG operating this LINE_HAUL leg —
   * optional for the same cross-deploy reason as pickupPhotoUrls above, since
   * shipment.service.ts started returning it in this same change. Null means
   * no carrier organization assigned yet, not "the API doesn't know".
   */
  operatedByProviderId?: string | null;
  operatorName?: string | null;
  /**
   * MDF-624/DISPATCH-2: the SAME field the ops board reads, one computation
   * in `serialize()` shared by both — null for an automatic offer (self-
   * healing, has its own offerExpiresAt) as well as for every accepted,
   * unassigned or closed leg; set only for a manual assignment still
   * waiting on the driver. Deliberately NOT re-derived client-side from
   * courierStatus/assignedAt/acceptedAt: an earlier version of this screen
   * did that with a two-clause test (no offerExpiresAt on this payload to
   * make it three), which silently matched a healthy automatic offer too.
   * Optional for the same cross-deploy reason as pickupPhotoUrls above.
   */
  manualAssignmentPendingSince?: string | null;
  courier?: { displayName: string | null } | null;
}

interface Provider {
  id: string;
  businessName: string;
  isActive: boolean;
  isTest: boolean;
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
  origin: { name: string | null; address: string | null; city: string | null; district: string | null; latitude: number | null; longitude: number | null };
  destination: { name: string | null; address: string | null; city: string | null; district: string | null; latitude: number | null; longitude: number | null };
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

/**
 * Mirrors `SCHEDULABLE_LEG_STATUSES` (`shipment.service.ts`) — a positive
 * allow-list, not "not finished yet", same discipline the API's own CLAUDE.md
 * names. This list only decides whether the control is worth showing; the
 * server's own guard is what actually enforces it, and its refusal — should
 * this list ever drift from the server's — surfaces verbatim through `act()`.
 */
const SCHEDULABLE_LEG_STATUSES = new Set(['PENDING', 'READY', 'IN_PROGRESS', 'EXCEPTION']);
const canScheduleLeg = (leg: Leg) => leg.kind === 'LINE_HAUL' && SCHEDULABLE_LEG_STATUSES.has(leg.status);

/**
 * D4 (owner): "when a provider or lane cannot take a line-haul the screen
 * must say WHY, gate by gate" — a flat omission from the dropdown fails that
 * bar as badly as a flat "not eligible" would, because the admin has no way
 * to tell a deactivated carrier from one that was never onboarded. Mirrors
 * the first two gates `assertOperableProvider` (apps/api) enforces, in the
 * same order, so the reason shown here can never describe a different rule
 * than the one that will actually refuse the POST.
 *
 * Deliberately NOT a third gate: whether the carrier's own SHIPPING_PROVIDER
 * role is still APPROVED is not part of the `GET /admin/logistics/providers`
 * response, so it cannot be checked here — that one case still only
 * surfaces reactively, via the POST's own error message below the picker.
 */
function operatorIneligibilityReason(p: Provider, shipmentIsTest: boolean): string | null {
  if (!p.isActive) return 'deactivated';
  if (shipmentIsTest && !p.isTest) return 'not a simulation carrier';
  if (!shipmentIsTest && p.isTest) return 'a simulation-only carrier';
  return null;
}

export default function ShipmentOpsPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(String(params.reference ?? ''));

  const [s, setS] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Record<string, { pin: string; who: string }>>({});
  const [schedule, setSchedule] = useState<Record<string, { departure: string; arrival: string }>>({});
  const [canOperate, setCanOperate] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [operatorPick, setOperatorPick] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<{ legId: string; currentOperator: string | null } | null>(null);

  // Every control on this screen — depart/arrive, confirm handover, flag a
  // problem, record a hub collection — is drawn only for logistics.operate.
  // /me returns the same grant rows the PermissionsGuard evaluates, so what
  // this screen shows and what the API enforces cannot disagree. On any
  // doubt (request fails, field absent) every control stays hidden: fail
  // closed. This page only ever needed logistics.read to load (BMPL-270).
  // BMPL-364: resolving an exception by return/reroute can CHARGE the
  // customer, so the API gates its confirm step on the stronger
  // logistics.manage — this screen checks that one separately rather than
  // assuming operate implies it (see ExceptionResolution's own comment).
  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => {
        const perms = me.adminPermissions ?? [];
        setCanOperate(perms.includes('logistics.operate'));
        setCanManage(perms.includes('logistics.manage'));
      })
      .catch(() => {
        setCanOperate(false);
        setCanManage(false);
      });
  }, []);

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

  // The carrier directory, for the operator picker below. logistics.read,
  // same tier this whole page already needs to load at all — a reader with
  // no logistics.operate still sees who runs each leg, just not the control
  // to change it (canOperate gates the picker, not this fetch).
  useEffect(() => {
    api
      .get<Provider[]>('/admin/logistics/providers')
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

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

  /** Requirement 12's gap: recording a real carrier-committed departure/arrival for one line-haul leg. */
  async function submitSchedule(legId: string) {
    const f = schedule[legId] ?? { departure: '', arrival: '' };
    const body: Record<string, string> = {};
    if (f.departure) body.scheduledDepartureAt = new Date(f.departure).toISOString();
    if (f.arrival) body.scheduledArrivalAt = new Date(f.arrival).toISOString();
    const check = legScheduleSchema.safeParse(body);
    if (!check.success) {
      setErr(check.error.issues[0]?.message ?? 'Give a valid departure or arrival time.');
      return;
    }
    await act(legId, 'schedule', body);
  }

  /**
   * MDF-500/MDF-520 (D4): which carrier organization operates this
   * LINE_HAUL leg. The picker now shows every carrier with the two
   * client-checkable ineligibility gates (deactivated, wrong simulation
   * side) disabled and named inline, rather than silently omitting them —
   * see `operatorIneligibilityReason` above. The one gate that cannot be
   * checked here (whether the carrier's SHIPPING_PROVIDER role is still
   * APPROVED) still surfaces only reactively, via the POST's own error
   * below, because that field is not part of the providers list response.
   * Closing that one needs `apps/api` work, outside this change. An empty
   * pick clears the assignment (the server accepts `providerProfileId:
   * null`) rather than being disabled — taking a carrier off a leg is a
   * real, named action, not an error state.
   */
  async function assignOperator(legId: string) {
    const picked = operatorPick[legId] ?? '';
    await act(legId, 'operator', { providerProfileId: picked || null });
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
        <div className="flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
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
                <p className="mt-2 break-words text-sm text-[color:var(--bmpl-text-muted)]">{s.explanation}</p>
              </div>
              <p className="shrink-0 text-lg font-bold tabular-nums text-[color:var(--bmpl-text)]">
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">{label}</p>
                  <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text)]">{end.name ?? '—'}</p>
                  {end.address && <p className="break-words text-sm text-[color:var(--bmpl-text-muted)]">{end.address}</p>}
                  <p className="text-sm text-[color:var(--bmpl-text-muted)]">
                    {[end.city, end.district?.replace(/_/g, ' ')].filter(Boolean).join(', ')}
                  </p>
                </div>
              ))}
            </div>

            {/*
             * MDF-538 (owner section 8): with no map, a text/pin mismatch is
             * invisible to an administrator -- the exact disagreement
             * `movedFromSaved` already warns the CUSTOMER about at checkout.
             * Shown against the written address above, not instead of it, so
             * the disagreement (if any) is something a human can actually
             * see. Read-only, tap-to-load (AddressMapPreview never loads
             * tiles until asked) -- no pin editing here; a correction to a
             * customer-confirmed location is a different decision.
             */}
            <AddressMapPreview
              points={(
                [
                  ['From', s.origin],
                  ['To', s.destination],
                ] as const
              )
                .filter(([, end]) => end.latitude != null && end.longitude != null)
                .map(([label, end]): MapPoint => ({
                  latitude: end.latitude!,
                  longitude: end.longitude!,
                  label: `${label}: ${end.name ?? end.address ?? [end.city, end.district].filter(Boolean).join(', ')}`,
                }))}
              title={`${reference} · route`}
              emptyHint="No pin on file for either end of this shipment."
              className="mt-4"
            />
          </Card>

          {/* Ready to collect: the one thing no leg transition can close out. */}
          {s.status === 'AWAITING_COLLECTION' && (
            <Card className="border-emerald-300 bg-emerald-50/50 p-4">
              <p className="text-sm font-semibold text-emerald-900">Waiting to be collected</p>
              <p className="mt-1 text-sm text-emerald-800">
                Record the collection when the recipient picks it up. Nothing else can close this shipment.
              </p>
              {canOperate && (
                <Button onClick={recordCollection} disabled={busy === 'collect'} className="mt-3">
                  {busy === 'collect' ? 'Recording…' : 'Record collection'}
                </Button>
              )}
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Legs</h2>
            <ol className="mt-3 space-y-3">
              {s.legs.map((leg) => {
                const c = controlsFor(leg);
                const h = handoff[leg.id] ?? { pin: '', who: '' };
                return (
                  <li key={leg.id} className="rounded-bmpl-md border border-[color:var(--bmpl-border)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-[color:var(--bmpl-text)]">
                          {leg.sequence}. {leg.description ?? `${leg.modeLabel} leg`}
                        </p>
                        <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-muted)]">
                          {leg.kind.replace(/_/g, ' ').toLowerCase()} · {leg.modeLabel}
                          {leg.carrier ? ` · ${leg.carrier}` : ''}
                          {leg.carrierBookingRef ? ` · ref ${leg.carrierBookingRef}` : ''}
                          {leg.scheduleNote ? ` · ${leg.scheduleNote}` : ''}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[color:var(--bmpl-text-muted)]">
                          {leg.departedAt == null && when(leg.scheduledDepartureAt) && (
                            <span>Scheduled to depart {when(leg.scheduledDepartureAt)}</span>
                          )}
                          {leg.arrivedAt == null && when(leg.scheduledArrivalAt) && (
                            <span>Scheduled to arrive {when(leg.scheduledArrivalAt)}</span>
                          )}
                          {when(leg.departedAt) && <span>Departed {when(leg.departedAt)}</span>}
                          {when(leg.arrivedAt) && <span>Arrived {when(leg.arrivedAt)}</span>}
                          {when(leg.completedAt) && <span>Handed over {when(leg.completedAt)}</span>}
                          {leg.handoffReceivedByName && <span>Taken by {leg.handoffReceivedByName}</span>}
                        </div>
                        {leg.exceptionReason && (
                          <p className="mt-1 break-words text-xs font-medium text-[color:var(--bmpl-warning)]">{leg.exceptionReason}</p>
                        )}
                        {leg.pickupPhotoUrls && leg.pickupPhotoUrls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {leg.pickupPhotoUrls.map((url, i) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={i}
                                src={url}
                                alt={`Pickup photo ${i + 1}`}
                                className="h-14 w-14 rounded-bmpl-md border border-[color:var(--bmpl-border)] object-cover"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <Badge tone={leg.status === 'COMPLETED' ? 'success' : leg.status === 'EXCEPTION' ? 'warning' : 'info'}>
                        {leg.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>

                    {leg.manualAssignmentPendingSince && (
                      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
                        <p className="text-sm font-medium text-amber-800">
                          Manually assigned to {leg.courier?.displayName ?? 'a driver'}, still waiting for them to accept —
                          assigned {relativeTime(leg.manualAssignmentPendingSince)}.
                        </p>
                        {canOperate && (
                          <Button
                            variant="outline"
                            className="mt-2"
                            disabled={busy != null}
                            onClick={() => setAssigning({ legId: leg.id, currentOperator: leg.courier?.displayName ?? null })}
                          >
                            Reassign driver
                          </Button>
                        )}
                      </div>
                    )}

                    {canOperate && (c.depart || c.arrive || c.handoff) && (
                      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
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

                    {canOperate && leg.status !== 'COMPLETED' && leg.status !== 'CANCELLED' && leg.status !== 'EXCEPTION' && (
                      <button
                        onClick={() => void flagException(leg.id)}
                        className="mt-2 text-xs font-medium text-[color:var(--bmpl-warning)] hover:underline"
                      >
                        Report a problem with this leg
                      </button>
                    )}

                    {/*
                     * Requirement 12's gap: scheduleLeg() (POST legs/:id/schedule)
                     * already exists, is tested and already writes these two
                     * columns — this is its only caller anywhere. Line-haul only
                     * (a courier leg's timing is dispatch, not a published
                     * schedule), mirroring SCHEDULABLE_LEG_STATUSES so the control
                     * is not even offered on a leg the server would refuse — but
                     * the server's own guard is what actually enforces that, and
                     * any drift between this list and that one surfaces through
                     * the real refusal message below, not a silently wrong UI.
                     */}
                    {/*
                     * MDF-500: which carrier ORG operates
                     * this line-haul leg, through the interface rather than
                     * only by API. The current assignment is visible to
                     * anyone who can load this page (same read as the rest
                     * of the leg); only logistics.operate gets the control
                     * to change it, same gate the depart/arrive buttons use.
                     * Courier legs (FIRST_MILE/LAST_MILE) are BML driver
                     * work and never show this — a carrier organization has
                     * nothing to do with them.
                     */}
                    {leg.kind === 'LINE_HAUL' && leg.status !== 'COMPLETED' && leg.status !== 'CANCELLED' && (
                      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">Carrier</p>
                        {/* MDF-560 (owner): "booked but no carrier" must read as
                            awaiting fulfilment, not as a routine, low-priority
                            detail -- the muted tone this used to carry said the
                            opposite of what it meant. */}
                        <p className="mt-1 text-sm text-[color:var(--bmpl-text)]">
                          {leg.operatorName ?? <span className="font-medium text-[color:var(--bmpl-warning)]">Not assigned</span>}
                        </p>
                        {canOperate && (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <Field label="Assign carrier" htmlFor={`op-${leg.id}`}>
                              <Select
                                id={`op-${leg.id}`}
                                value={operatorPick[leg.id] ?? leg.operatedByProviderId ?? ''}
                                onChange={(e) => setOperatorPick({ ...operatorPick, [leg.id]: e.target.value })}
                                className="w-56"
                              >
                                <option value="">— none —</option>
                                {providers.map((p) => {
                                  const reason = operatorIneligibilityReason(p, s.isTest);
                                  return (
                                    <option key={p.id} value={p.id} disabled={!!reason}>
                                      {reason ? `${p.businessName} — ${reason}` : p.businessName}
                                    </option>
                                  );
                                })}
                              </Select>
                            </Field>
                            <Button
                              variant="outline"
                              disabled={busy != null || (operatorPick[leg.id] ?? leg.operatedByProviderId ?? '') === (leg.operatedByProviderId ?? '')}
                              onClick={() => void assignOperator(leg.id)}
                            >
                              {busy === `${leg.id}:operator` ? 'Saving…' : 'Assign'}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {canOperate && canScheduleLeg(leg) && (
                      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">Carrier schedule</p>
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <Field label="Departs">
                            <Input
                              type="datetime-local"
                              value={schedule[leg.id]?.departure ?? ''}
                              onChange={(e) =>
                                setSchedule({
                                  ...schedule,
                                  [leg.id]: { departure: e.target.value, arrival: schedule[leg.id]?.arrival ?? '' },
                                })
                              }
                            />
                          </Field>
                          <Field label="Arrives">
                            <Input
                              type="datetime-local"
                              value={schedule[leg.id]?.arrival ?? ''}
                              onChange={(e) =>
                                setSchedule({
                                  ...schedule,
                                  [leg.id]: { departure: schedule[leg.id]?.departure ?? '', arrival: e.target.value },
                                })
                              }
                            />
                          </Field>
                          <Button
                            variant="outline"
                            disabled={busy != null || !((schedule[leg.id]?.departure || schedule[leg.id]?.arrival))}
                            onClick={() => void submitSchedule(leg.id)}
                          >
                            {busy === `${leg.id}:schedule` ? 'Saving…' : 'Save schedule'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* BMPL-364: once a return has already been booked against
                        this shipment, s.status flips to RETURNED (BMPL-356) —
                        that is read here, not re-derived, same "client
                        restates nothing the server owns" rule as everywhere
                        else on this page. A reroute leaves status at
                        EXCEPTION (a known, named gap — see the branch's own
                        comment), so a second reroute attempt is instead
                        caught honestly by the confirm endpoint's own guard
                        and surfaced through this panel's existing error
                        state, not pre-empted here. */}
                    {/*
                     * Requirement 10's gap, distinct from the return/reroute
                     * panel above: resuming the SAME leg, or releasing an
                     * assigned driver, with no new transport service booked
                     * and nothing charged. Both panels mount side by side on
                     * the same EXCEPTION leg — an operator picks whichever
                     * fate actually applies; resolveException's own guards
                     * (settled return/reroute, already resolved, etc.) are
                     * the real gate, this is only where the trigger shows.
                     */}
                    {canOperate && leg.status === 'EXCEPTION' && s.status !== 'RETURNED' && (
                      <>
                        <ExceptionResolution legId={leg.id} canManage={canManage} onResolved={load} />
                        <ExceptionRecovery legId={leg.id} legKind={leg.kind} onResolved={load} />
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Chain of custody</h2>
            <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-muted)]">Append-only. Nothing on this screen can rewrite it.</p>
            <ul className="mt-3 space-y-2">
              {s.custody.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-2 text-xs text-[color:var(--bmpl-text-muted)]">
                  <span className="font-medium text-[color:var(--bmpl-text)]">
                    {c.fromHolder ? `${c.fromHolder.toLowerCase()} → ` : ''}
                    {c.toHolder.toLowerCase()}
                  </span>
                  {c.actorLabel && <span>{c.actorLabel}</span>}
                  {c.note && <span className="text-[color:var(--bmpl-text-muted)]">{c.note}</span>}
                  <span className="text-[color:var(--bmpl-text-faint)]">{when(c.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {assigning && (
        <LegAssignModal
          legId={assigning.legId}
          mode="reassign"
          currentOperator={assigning.currentOperator}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
