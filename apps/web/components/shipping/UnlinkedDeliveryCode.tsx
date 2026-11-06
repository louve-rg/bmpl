'use client';

import { useEffect, useState } from 'react';
import { shippingApi } from '../../lib/shipping';
import type { ApiError } from '../../lib/api';
import { Alert, Button } from '../ui';

const COOLDOWN_MS = 5 * 60_000; // mirrors the API's own 5-minute per-shipment cooldown

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * CLOSE-2, unlinked-recipient path: get the delivery code by email, no BML
 * account required — the public-tracking-link counterpart to
 * `RecipientDeliveryCode`. Two steps, matching the API exactly:
 *
 * 1. Request: emails a short-lived, single-use code to whatever address is
 *    on file for this shipment.
 * 2. Reveal: trade that emailed code for the actual delivery code.
 *
 * THE ONE RULE THIS COMPONENT MUST NOT BREAK: the request step shows the
 * SAME message whatever the API actually did — whether an email was on file,
 * whether one was already sent inside the cooldown, all of it. The API
 * returns `{ requested: true }` identically in every case on purpose (owner
 * ruling: a public tracking link must never let a stranger learn whether a
 * shipment has a reachable recipient). Never add a "no email on file"
 * message here, and never infer one from timing.
 *
 * The 5-minute cooldown readout below is a CLIENT-SIDE approximation, not a
 * value the API reports — it exists purely so a second press during the
 * real server-side cooldown reads as "wait a bit", not as broken.
 */
export function UnlinkedDeliveryCode({ token }: { token: string }) {
  const [phase, setPhase] = useState<'idle' | 'sent' | 'revealed'>('idle');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [revealInput, setRevealInput] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);

  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cooldownUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const cooldownRemaining = cooldownUntil ? Math.max(0, cooldownUntil - now) : 0;
  const onCooldown = cooldownRemaining > 0;

  async function requestCode() {
    setRequesting(true);
    setRequestError(null);
    try {
      await shippingApi.requestDeliveryCodeEmail(token);
      setPhase('sent');
      setCooldownUntil(Date.now() + COOLDOWN_MS);
    } catch (e) {
      // A genuine failure to even make the request — not a signal about
      // whether an email exists. Status 429 here is the server's own
      // StrictThrottle, not the per-shipment cooldown; both read the same
      // to a visitor, so one honest message covers either.
      setRequestError((e as ApiError).message || 'Could not send that request. Try again in a moment.');
    } finally {
      setRequesting(false);
    }
  }

  async function revealCode() {
    if (!revealInput.trim()) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const result = await shippingApi.revealDeliveryCode(token, revealInput.trim().toUpperCase());
      setDeliveryCode(result.deliveryCode);
      setPhase('revealed');
    } catch (e) {
      // The server's own message already covers invalid/expired/used — never
      // elaborate on top of it.
      setRevealError((e as ApiError).message || 'That code is invalid or has expired. Request a new one.');
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div data-theme="light" className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Get your delivery code</h2>
      <p className="mt-1 text-sm text-slate-600">
        Your driver will ask for this code to confirm it&rsquo;s you before handing over the parcel. No account needed.
      </p>

      {phase === 'revealed' ? (
        deliveryCode ? (
          <p className="mt-3 text-center text-3xl font-bold tracking-[0.3em] text-belize-navy">{deliveryCode}</p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">No delivery code to show for this parcel right now.</p>
        )
      ) : (
        <>
          {phase === 'sent' && (
            <Alert tone="info" className="mt-3">
              If an email is on file for this parcel, we&rsquo;ve sent a short code to it. Check your inbox (and spam
              folder), then enter it below.
            </Alert>
          )}

          {phase === 'sent' && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Code from your email
                </span>
                <input
                  value={revealInput}
                  onChange={(e) => setRevealInput(e.target.value.toUpperCase())}
                  maxLength={10}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="e.g. 7K3P9RQAXM"
                  className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base uppercase tracking-widest text-slate-900 sm:w-56"
                />
              </label>
              <Button onClick={() => void revealCode()} disabled={revealing || !revealInput.trim()} className="min-h-[44px]">
                {revealing ? 'Checking…' : 'Confirm code'}
              </Button>
            </div>
          )}

          {revealError && (
            <Alert tone="warning" className="mt-3">
              {revealError}
            </Alert>
          )}

          {requestError && (
            <Alert tone="warning" className="mt-3">
              {requestError}
            </Alert>
          )}

          <Button
            variant={phase === 'sent' ? 'ghost' : 'primary'}
            size={phase === 'sent' ? 'sm' : undefined}
            onClick={() => void requestCode()}
            disabled={requesting || onCooldown}
            className={phase === 'sent' ? 'mt-3' : 'mt-3 min-h-[44px]'}
          >
            {requesting
              ? 'Sending…'
              : onCooldown
                ? `You can request another code in ${formatRemaining(cooldownRemaining)}`
                : phase === 'sent'
                  ? 'Resend code'
                  : 'Email me a delivery code'}
          </Button>
        </>
      )}
    </div>
  );
}
