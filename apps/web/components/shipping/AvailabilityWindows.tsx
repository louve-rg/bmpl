'use client';

import { useState } from 'react';
import { shippingApi, type ShipmentLegView, type ShipmentView } from '../../lib/shipping';
import { Alert, Button } from '../ui';
import type { ApiError } from '../../lib/api';

type Role = 'SENDER' | 'RECIPIENT';

interface Row {
  startTime: string;
  endTime: string;
}

const NOT_STARTED = new Set(['PENDING', 'READY']);
const MAX_ROWS_PER_ROLE = 5;

/**
 * BMPL-288: let a sender set pickup/delivery availability windows, matching
 * exactly what ShipmentService.setAvailabilityWindows enforces server-side —
 * this form does not invent a stricter rule than the API's own.
 *
 * A DIRECT leg governs both roles at once; otherwise SENDER is FIRST_MILE and
 * RECIPIENT is LAST_MILE. A service that ends at a hub has no LAST_MILE and
 * no DIRECT leg, so the recipient has no governing leg at all — that role's
 * section is simply not rendered, per the API's own "no governing leg is
 * refused outright" rule. Nothing here invents a fallback for it.
 */
function governingLeg(shipment: ShipmentView, role: Role): ShipmentLegView | null {
  const direct = shipment.legs.find((l) => l.kind === 'DIRECT');
  if (direct) return direct;
  const kind = role === 'SENDER' ? 'FIRST_MILE' : 'LAST_MILE';
  return shipment.legs.find((l) => l.kind === kind) ?? null;
}

function windowsFor(shipment: ShipmentView, role: Role): Row[] {
  return shipment.availabilityWindows.filter((w) => w.role === role).map((w) => ({ startTime: w.startTime, endTime: w.endTime }));
}

function formatClock(hhmm: string): string {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Overnight (22:00-02:00) is a legitimate, deliberately-supported shape —
 *  dispatch handles the wraparound; this only ever describes it, never
 *  refuses it. */
function formatWindow(w: Row): string {
  const overnight = w.endTime < w.startTime;
  return `${formatClock(w.startTime)}–${formatClock(w.endTime)}${overnight ? ' (overnight)' : ''}`;
}

function RoleEditor({ label, rows, onChange }: { label: string; rows: Row[]; onChange: (rows: Row[]) => void }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-900">{label}</p>
      {rows.length === 0 && <p className="mt-1 text-sm text-slate-500">No window set — we'll attempt this at any time.</p>}
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              aria-label={`${label} start time`}
              value={r.startTime}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
              className="bmpl-input min-h-[44px] w-auto px-2 py-1"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              aria-label={`${label} end time`}
              value={r.endTime}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
              className="bmpl-input min-h-[44px] w-auto px-2 py-1"
            />
            <Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {rows.length < MAX_ROWS_PER_ROLE && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => onChange([...rows, { startTime: '', endTime: '' }])}>
          + Add a window
        </Button>
      )}
    </div>
  );
}

export function AvailabilityWindows({ shipment, onUpdated }: { shipment: ShipmentView; onUpdated: (s: ShipmentView) => void }) {
  const senderLeg = governingLeg(shipment, 'SENDER');
  const recipientLeg = governingLeg(shipment, 'RECIPIENT');
  const senderEditable = !!senderLeg && NOT_STARTED.has(senderLeg.status);
  const recipientEditable = !!recipientLeg && NOT_STARTED.has(recipientLeg.status);

  const storedSender = windowsFor(shipment, 'SENDER');
  const storedRecipient = windowsFor(shipment, 'RECIPIENT');

  const [senderRows, setSenderRows] = useState<Row[]>(storedSender);
  const [recipientRows, setRecipientRows] = useState<Row[]>(storedRecipient);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!senderLeg && !recipientLeg) return null;

  async function commit(windows: Array<Row & { role: Role }>) {
    const incomplete = windows.find((w) => !w.startTime || !w.endTime);
    if (incomplete) {
      setErr('Fill in both times for each window, or remove it.');
      return;
    }
    const zeroDuration = windows.find((w) => w.startTime === w.endTime);
    if (zeroDuration) {
      setErr('A window needs a start time different from its end time.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      onUpdated(await shippingApi.setAvailabilityWindows(shipment.id, windows));
    } catch (e) {
      setErr((e as ApiError).message ?? 'We could not save this.');
    } finally {
      setBusy(false);
    }
  }

  // A locked role is never included in a save — see the module comment: the
  // API refuses "setting" it once its leg has started, and dropping it here
  // is exactly the "clearing is always allowed" case, not a bug.
  function save() {
    void commit([
      ...(senderEditable ? senderRows.map((r) => ({ ...r, role: 'SENDER' as const })) : []),
      ...(recipientEditable ? recipientRows.map((r) => ({ ...r, role: 'RECIPIENT' as const })) : []),
    ]);
  }

  // The explicit clear affordance for a role whose leg has already started —
  // "clearing is allowed always" independent of that lock. The other role's
  // still-editable rows are carried along unchanged so clearing one role
  // never silently drops the other (replace-all covers the whole shipment).
  function clearLocked(role: Role) {
    void commit([
      ...(role !== 'SENDER' && senderEditable ? senderRows.map((r) => ({ ...r, role: 'SENDER' as const })) : []),
      ...(role !== 'RECIPIENT' && recipientEditable ? recipientRows.map((r) => ({ ...r, role: 'RECIPIENT' as const })) : []),
    ]);
  }

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Availability</h2>
      <p className="mt-1 text-sm text-slate-600">
        Set the hours someone will be there for pickup or delivery. Leave this blank and we'll attempt it at any time — that's
        how every shipment works unless you set a window here.
      </p>

      <div className="mt-4 space-y-5">
        {senderLeg &&
          (senderEditable ? (
            <RoleEditor label="When you'll be there for pickup" rows={senderRows} onChange={setSenderRows} />
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-900">When you'll be there for pickup</p>
              {storedSender.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>{storedSender.map(formatWindow).join(', ')}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => clearLocked('SENDER')}>
                    Clear
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">The pickup has already started, so this can no longer be set.</p>
              )}
            </div>
          ))}

        {recipientLeg &&
          (recipientEditable ? (
            <RoleEditor
              label={
                shipment.destination.name
                  ? `When ${shipment.destination.name} will be there for delivery`
                  : 'When the recipient will be there for delivery'
              }
              rows={recipientRows}
              onChange={setRecipientRows}
            />
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-900">When the recipient will be there for delivery</p>
              {storedRecipient.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>{storedRecipient.map(formatWindow).join(', ')}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => clearLocked('RECIPIENT')}>
                    Clear
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">The delivery has already started, so this can no longer be set.</p>
              )}
            </div>
          ))}
      </div>

      {err && (
        <Alert tone="warning" className="mt-3">
          {err}
        </Alert>
      )}

      {(senderEditable || recipientEditable) && (
        <Button className="mt-4 min-h-[44px] w-full sm:w-auto" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save availability'}
        </Button>
      )}
    </div>
  );
}
