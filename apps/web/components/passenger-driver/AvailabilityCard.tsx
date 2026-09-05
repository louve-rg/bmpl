'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Badge, Card as UiCard, type Tone } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import {
  PASSENGER_AVAILABILITY_OPTIONS,
  availabilityTone,
  type PassengerDriverProfile,
  type PassengerEligibility,
} from '../../lib/passenger-driver';

/**
 * The passenger driver's availability switch, mirroring the delivery driver's:
 * the states are exactly the server's, SUSPENDED renders as a locked
 * explanation rather than a fourth button, and eligibility is the server's
 * answer — ONLINE is disabled when it says no, with the reasons shown ABOVE
 * the control, and the server rejects the PATCH independently if the UI is
 * ever wrong.
 */
export function AvailabilityCard({
  profile,
  eligibility,
  onDone,
}: {
  profile: PassengerDriverProfile;
  eligibility: PassengerEligibility;
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
      await api.patch('/passenger/driver/availability', { availability: v });
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const tone: Tone = availabilityTone(current);
  const currentLabel = PASSENGER_AVAILABILITY_OPTIONS.find((o) => o.value === current)?.label ?? 'Suspended';

  return (
    <UiCard className={`p-4 sm:p-6 ${current === 'ONLINE' ? 'border-emerald-300 bg-emerald-50/40' : ''}`} aria-live="polite">
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
          Your passenger-driver role is suspended, so availability can&rsquo;t be changed. An administrator has to lift
          the suspension.
        </p>
      ) : (
        <>
          {!eligibility.canGoOnline && eligibility.reasons.length > 0 && (
            <Alert tone="warning" className="mt-3" title="Before you can go online">
              <ul className="list-disc pl-5">
                {eligibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PASSENGER_AVAILABILITY_OPTIONS.map((o) => {
              const active = current === o.value;
              const disabled = busy || active || (o.value === 'ONLINE' && !eligibility.canGoOnline);
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setAvailability(o.value)}
                  className={`rounded-bmpl-md border px-3 py-2 text-left transition ${
                    active
                      ? 'border-belize-blue bg-belize-blue/5 ring-1 ring-belize-blue'
                      : 'border-slate-200 hover:border-belize-blue/50'
                  } ${disabled && !active ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className="block text-sm font-semibold text-belize-navy">{o.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{o.hint}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </UiCard>
  );
}
