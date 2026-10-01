'use client';

import { useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import { previewRerouteSchema, rerouteSchema, returnToSenderSchema, type RerouteInput } from '@bmpl/validation';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '../ui';
import { canPrice, confirmLabel, needsPaymentConfirmation, priceUnavailableMessage, type QuotePreview } from '../../lib/exception-resolution';

/**
 * Resolving an exceptional leg by returning the parcel or redirecting it
 * (BMPL-364/183/343) — ONE panel covering both fates, not two screens, so an
 * operator picks the fate once and everything after (price, confirmation,
 * charge) follows the same shape either way.
 *
 * THE OWNER'S RULES THIS PANEL ENFORCES, NOT JUST DISPLAYS:
 *  - A return/reroute is priced with BML's real configured pricing — never a
 *    fixed fee, never a number this screen invents. Every price shown here
 *    came back from the API's own `quote()`, verbatim.
 *  - Calculate, SHOW the price, take an EXPLICIT confirmation, then the
 *    existing payment path — never silent. The confirm button always states
 *    the amount (or the honest absence of one) out loud; see
 *    `exception-resolution.ts`'s `confirmLabel`.
 *  - When no valid price can be calculated, the action stays PENDING_MANUAL —
 *    this panel never offers a button that would silently charge nothing
 *    while looking like a real confirmation (`canPrice`/`priceUnavailableMessage`).
 *  - A reroute that does not increase the charge needs no payment-confirmation
 *    dialog, only a reroute that does (`needsPaymentConfirmation`) — the
 *    button label is the only thing that changes; there is still exactly one
 *    explicit click either way, never an auto-fired action.
 *
 * WHO CONFIRMS: both `return-to-sender` and `reroute` are staff-only routes
 * (`logistics.manage` — stronger than the `logistics.operate` this whole page
 * already gates on) — there is no customer-facing confirmation endpoint
 * anywhere in this codebase for either flow. Calling the confirm endpoint
 * below, as a staff member, IS the "explicit confirmation" the owner's
 * ruling names; the customer is informed afterward through the existing
 * notification path (`SHIPMENT_REROUTED`/audit trail), not through a second
 * UI this card did not find any route for.
 *
 * Nothing here rewrites a reservation, an oversell protection or a
 * historical fulfilment-origin snapshot — this panel only ever reads a
 * preview and, on confirm, calls the one approved booking/payment path the
 * API already enforces all of that inside of.
 */

interface DestinationForm {
  mode: 'ADDRESS' | 'HUB';
  hubId: string;
  name: string;
  phone: string;
  address: string;
  address2: string;
  city: string;
  district: string;
  instructions: string;
}

const EMPTY_DESTINATION: DestinationForm = {
  mode: 'ADDRESS',
  hubId: '',
  name: '',
  phone: '',
  address: '',
  address2: '',
  city: '',
  district: '',
  instructions: '',
};

function destinationPayload(f: DestinationForm): RerouteInput['destination'] {
  if (f.mode === 'HUB') {
    return { hubId: f.hubId || undefined, name: f.name.trim() || undefined, phone: f.phone.trim() || undefined };
  }
  return {
    name: f.name.trim() || undefined,
    phone: f.phone.trim() || undefined,
    address: f.address.trim() || undefined,
    address2: f.address2.trim() || undefined,
    city: f.city.trim() || undefined,
    district: (f.district || undefined) as RerouteInput['destination']['district'],
    instructions: f.instructions.trim() || undefined,
  };
}

interface Hub {
  id: string;
  code: string;
  name: string;
  city: string;
}

type Action = 'RETURN' | 'REROUTE';
type Outcome = { outcome: 'INITIATED'; reference: string } | { outcome: 'PENDING_MANUAL'; reason: string };

export function ExceptionResolution({
  legId,
  canManage,
  onResolved,
}: {
  legId: string;
  /**
   * Mounting this component at all already implies logistics.operate — same
   * convention as LegAssignModal: no permission check lives in here for
   * that, its parent gates the trigger. The charge-capable confirm step
   * needs the STRONGER logistics.manage specifically, same as the API
   * routes it calls (`return-to-sender`/`reroute`, unlike their own
   * operate-gated `-quote` preview siblings), so that one check does live
   * here, not in the parent.
   */
  canManage: boolean;
  onResolved: () => Promise<void>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [destination, setDestination] = useState<DestinationForm>(EMPTY_DESTINATION);
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setAction(null);
    setDestination(EMPTY_DESTINATION);
    setNote('');
    setPreview(null);
    setOutcome(null);
    setErr(null);
  }

  async function ensureHubs() {
    if (hubs !== null) return;
    try {
      setHubs(await api.get<Hub[]>('/admin/logistics/hubs'));
    } catch {
      setHubs([]); // the hub picker degrades to "none available" rather than blocking the panel
    }
  }

  async function startReturn() {
    setAction('RETURN');
    setErr(null);
    setPreviewing(true);
    try {
      setPreview(await api.post<QuotePreview>(`/admin/logistics/legs/${legId}/return-quote`));
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not price a return.');
    } finally {
      setPreviewing(false);
    }
  }

  function startReroute() {
    setAction('REROUTE');
    setErr(null);
    setPreview(null);
  }

  const rerouteDestinationCheck = previewRerouteSchema.safeParse({ destination: destinationPayload(destination) });

  async function previewTheReroute() {
    if (!rerouteDestinationCheck.success) {
      setErr(rerouteDestinationCheck.error.issues[0]?.message ?? 'Check the destination fields.');
      return;
    }
    setErr(null);
    setPreviewing(true);
    try {
      setPreview(
        await api.post<QuotePreview>(`/admin/logistics/legs/${legId}/reroute-quote`, { destination: destinationPayload(destination) }),
      );
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not price that redirect.');
    } finally {
      setPreviewing(false);
    }
  }

  const confirmCheck =
    action === 'RETURN'
      ? returnToSenderSchema.safeParse({ note: note.trim() })
      : rerouteSchema.safeParse({ destination: destinationPayload(destination), note: note.trim() });

  async function confirm() {
    if (!action || !preview || !confirmCheck.success) {
      setErr(confirmCheck.success ? null : confirmCheck.error.issues[0]?.message ?? 'Say why, first.');
      return;
    }
    setConfirming(true);
    setErr(null);
    try {
      const body = action === 'RETURN' ? { note: note.trim() } : { destination: destinationPayload(destination), note: note.trim() };
      const path = action === 'RETURN' ? 'return-to-sender' : 'reroute';
      const res = await api.post<
        | { outcome: 'PENDING_MANUAL'; reason: string }
        | { outcome: 'INITIATED'; returnShipment?: { reference: string }; rerouteShipment?: { reference: string } }
      >(`/admin/logistics/legs/${legId}/${path}`, body);
      setOutcome(
        res.outcome === 'PENDING_MANUAL'
          ? res
          : { outcome: 'INITIATED', reference: (res.returnShipment ?? res.rerouteShipment)!.reference },
      );
      await onResolved();
    } catch (e) {
      setErr((e as ApiError).message ?? 'That action was refused.');
    } finally {
      setConfirming(false);
    }
  }

  if (outcome) {
    return (
      <Alert tone={outcome.outcome === 'INITIATED' ? 'success' : 'warning'} title={outcome.outcome === 'INITIATED' ? 'Resolved' : 'Recorded as pending'}>
        {outcome.outcome === 'INITIATED' ? (
          <>This shipment's new leg is booked as {outcome.reference}.</>
        ) : (
          <>{outcome.reason} Nothing was charged. An operator will need to handle this manually.</>
        )}
      </Alert>
    );
  }

  if (action === null) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={startReturn}>
          Return to sender
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            startReroute();
            void ensureHubs();
          }}
        >
          Reroute to a new address
        </Button>
      </div>
    );
  }

  const priced = preview ? canPrice(preview) : false;

  return (
    <div className="mt-3 rounded-bmpl-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{action === 'RETURN' ? 'Return to sender' : 'Reroute to a new address'}</h3>
        <button type="button" onClick={reset} className="text-xs font-medium text-slate-500 hover:underline">
          Cancel
        </button>
      </div>

      {action === 'REROUTE' && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-1" role="group" aria-label="Destination kind">
            {(['ADDRESS', 'HUB'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={destination.mode === m}
                onClick={() => setDestination({ ...EMPTY_DESTINATION, mode: m })}
                className={`rounded-bmpl-sm px-3 py-1.5 text-xs font-semibold transition ${
                  destination.mode === m ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 border border-slate-300'
                }`}
              >
                {m === 'ADDRESS' ? 'Door address' : 'Terminal'}
              </button>
            ))}
          </div>

          {destination.mode === 'HUB' ? (
            <Field label="Terminal">
              {hubs === null ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Spinner className="h-3.5 w-3.5" /> Loading terminals…
                </div>
              ) : (
                <Select value={destination.hubId} onChange={(e) => setDestination({ ...destination, hubId: e.target.value })}>
                  <option value="">Select a terminal…</option>
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.code}) · {h.city}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <>
              <Field label="Address">
                <Input value={destination.address} onChange={(e) => setDestination({ ...destination, address: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="City">
                  <Input value={destination.city} onChange={(e) => setDestination({ ...destination, city: e.target.value })} />
                </Field>
                <Field label="District">
                  <Select value={destination.district} onChange={(e) => setDestination({ ...destination, district: e.target.value })}>
                    <option value="">Select a district…</option>
                    {DISTRICTS.map((d) => (
                      <option key={d} value={d}>
                        {DISTRICT_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recipient name">
              <Input value={destination.name} onChange={(e) => setDestination({ ...destination, name: e.target.value })} />
            </Field>
            <Field label="Recipient phone">
              <Input value={destination.phone} onChange={(e) => setDestination({ ...destination, phone: e.target.value })} />
            </Field>
          </div>

          {!preview && (
            <Button size="sm" onClick={() => void previewTheReroute()} disabled={previewing || !rerouteDestinationCheck.success}>
              {previewing ? 'Pricing…' : 'Get price'}
            </Button>
          )}
        </div>
      )}

      {action === 'RETURN' && previewing && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Pricing the return…
        </div>
      )}

      {preview && (
        <div className="mt-3 space-y-3">
          {priced ? (
            <p className="text-sm text-slate-700">
              This is a new transport service at BML's normal configured pricing:{' '}
              <span className="font-semibold tabular-nums">${((preview.totalMinor ?? 0) / 100).toFixed(2)}</span>.
              {action === 'REROUTE' &&
                (needsPaymentConfirmation(preview)
                  ? ' This increases what the customer already paid.'
                  : ' This does not increase what the customer already paid — they will still be told about the new delivery time.')}
            </p>
          ) : (
            <Alert tone="warning">We cannot price this — {priceUnavailableMessage(preview)} Operations must handle it manually.</Alert>
          )}

          <Field label="Note" hint="Why this is being resolved this way. The customer may see this.">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {err && <p className="text-sm font-medium text-red-600">{err}</p>}

          {canManage ? (
            <Button size="sm" onClick={() => void confirm()} disabled={confirming || !confirmCheck.success}>
              {confirming ? 'Submitting…' : confirmLabel(action, preview)}
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              You can preview this, but resolving it needs the stronger logistics-manage permission.
            </p>
          )}
        </div>
      )}

      {!preview && err && <p className="mt-2 text-sm font-medium text-red-600">{err}</p>}
    </div>
  );
}
