'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Badge, Card as UiCard, type Tone } from '../ui';
import { errMessage, type DriverProfile, type Eligibility } from './dashboard-data';

const OPTIONS: Array<{ value: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE'; label: string; hint: string }> = [
  { value: 'ONLINE', label: 'Online', hint: 'Taking new delivery offers' },
  { value: 'UNAVAILABLE', label: 'Unavailable', hint: 'On a break — no new offers' },
  { value: 'OFFLINE', label: 'Offline', hint: 'Off shift' },
];

/**
 * The driver's availability switch — the single most operationally important
 * control on the dashboard, so it sits at the very top of it.
 *
 * The three states are exactly the ones the backend supports
 * (`DriverAvailability`); nothing here invents a frontend-only status. SUSPENDED
 * is a fourth server state a driver cannot set, and is rendered as a locked
 * explanation rather than a fourth button.
 *
 * Eligibility is the server's answer, never this component's: `canGoOnline` and
 * its reasons come from DriverService, ONLINE is disabled when the server says
 * no, and the server rejects the PATCH independently if the UI is ever wrong.
 * The reasons are shown ABOVE the control — a greyed-out button with no visible
 * cause reads as a bug rather than as a requirement.
 */
export function AvailabilityControl({
  profile,
  eligibility,
  onDone,
}: {
  profile: DriverProfile;
  eligibility: Eligibility;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = profile.availability;
  const suspended = current === 'SUSPENDED';

  async function setAvailability(v: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE') {
    setBusy(true);
    setErr(null);
    try {
      await api.patch('/driver/availability', { availability: v });
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const tone: Tone = suspended ? 'error' : current === 'ONLINE' ? 'success' : current === 'UNAVAILABLE' ? 'warning' : 'neutral';
  const currentLabel = OPTIONS.find((o) => o.value === current)?.label ?? 'Suspended';

  return (
    <UiCard
      className={`p-4 sm:p-6 ${current === 'ONLINE' ? 'border-emerald-300 bg-emerald-50/40' : ''}`}
      // aria-live: going online/offline is a state change the driver needs
      // confirmed, and on a phone the badge may be the only thing they see.
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="bmpl-eyebrow">Availability</h2>
        <Badge tone={tone}>{currentLabel}</Badge>
      </div>

      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}

      {suspended ? (
        <p className="mt-3 text-sm text-slate-600">
          Your driver role is suspended, so availability can&rsquo;t be changed. An administrator has to lift the
          suspension.
        </p>
      ) : (
        <>
          {!eligibility.canGoOnline && eligibility.reasons.length > 0 && (
            <Alert tone="warning" title="You can’t go online yet" className="mt-3">
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {eligibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Fix these and this updates straight away — no need to sign out.</p>
            </Alert>
          )}

          {/* Stacked on phones, side by side from `sm`. Each button is a full
              44px target with its meaning under the label: "Unavailable" and
              "Offline" are not self-explanatory at a kerbside. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="group" aria-label="Set availability">
            {OPTIONS.map((o) => {
              const active = current === o.value;
              const disabled = busy || (o.value === 'ONLINE' && !eligibility.canGoOnline);
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  title={disabled && o.value === 'ONLINE' ? eligibility.reasons.join('; ') : undefined}
                  onClick={() => setAvailability(o.value)}
                  className={`min-h-[44px] rounded-bmpl-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? 'border-belize-blue bg-belize-blue text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className={`block text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}>{o.hint}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </UiCard>
  );
}
