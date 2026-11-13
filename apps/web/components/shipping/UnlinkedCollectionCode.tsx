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
 * MDF-738: the cooldown used to be in-memory `useState` only, so a reload
 * of /track/[token] (or just closing and reopening the tab) brought the
 * button back as if nothing had been requested, while the SERVER's own
 * cooldown was still running -- the neutral `{ requested: true }` response
 * then reads as a lie: "we sent it" when the server actually did nothing.
 * Persisting per-token in localStorage is a convenience only: on any
 * failure (private browsing, storage disabled) this degrades to exactly
 * today's in-memory-only behaviour, never a crash. Deliberately NOT a
 * question to the server about when it will next send -- that would hand
 * back the exact oracle the neutral response exists to deny (whether an
 * email is on file), trading the security property for the usability one
 * instead of keeping both.
 */
function cooldownStorageKey(token: string): string {
  return `bml-collection-code-cooldown:${token}`;
}

function readStoredCooldown(token: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cooldownStorageKey(token));
    const until = raw ? Number(raw) : NaN;
    return Number.isFinite(until) && until > Date.now() ? until : null;
  } catch {
    return null;
  }
}

function storeCooldown(token: string, until: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cooldownStorageKey(token), String(until));
  } catch {
    // Convenience only -- losing it just means no persistence, not a crash.
  }
}

function clearStoredCooldown(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(cooldownStorageKey(token));
  } catch {
    // Nothing to do -- an expired entry is already harmless (readStoredCooldown ignores it).
  }
}

/**
 * MDF-710: the destination the collection-ready email already promises
 * ("Visit your tracking page to see your collection code") but that, until
 * this component existed, nothing in apps/web actually built — Stanley
 * found the gap by grepping for a non-test caller of the request/reveal
 * routes and finding none. Same two-step shape as `UnlinkedDeliveryCode`,
 * the component this mirrors line for line:
 *
 * 1. Request: emails a short-lived, single-use reveal token to whatever
 *    address is on file for this shipment.
 * 2. Reveal: trade that emailed token for the actual collection code.
 *
 * Security boundary (explicit owner instruction): the collection code must
 * never appear through the unrestricted tracking link itself — only this
 * token-gated request/reveal exchange reveals it, matching exactly what
 * `ShipmentService.requestCollectionCodeEmail`/`revealCollectionCode`
 * already enforce server-side. Nothing here embeds the code in the URL or
 * renders it to anyone who merely knows a tracking reference.
 *
 * THE ONE RULE THIS COMPONENT MUST NOT BREAK, same as the delivery-code
 * sibling: the request step shows the SAME message whatever the API
 * actually did. Never add a "no email on file" message here.
 *
 * The emailed token is NOT the collection code and must never be presented
 * as one — the backend's own email text (shipment.service.ts,
 * `requestCollectionCodeEmail`) warns the recipient never to hand it to a
 * terminal clerk, since a clerk has no way to validate it and five wrong
 * attempts would burn real collection-PIN attempts. This component repeats
 * that warning rather than contradicting it.
 */
export function UnlinkedCollectionCode({ token }: { token: string }) {
  const [phase, setPhase] = useState<'idle' | 'sent' | 'revealed'>('idle');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [revealInput, setRevealInput] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [collectionCode, setCollectionCode] = useState<string | null>(null);

  const [cooldownUntil, setCooldownUntil] = useState<number | null>(() => readStoredCooldown(token));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cooldownUntil) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= cooldownUntil) clearStoredCooldown(token);
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownUntil, token]);

  const cooldownRemaining = cooldownUntil ? Math.max(0, cooldownUntil - now) : 0;
  const onCooldown = cooldownRemaining > 0;

  async function requestCode() {
    setRequesting(true);
    setRequestError(null);
    try {
      await shippingApi.requestCollectionCodeEmail(token);
      setPhase('sent');
      const until = Date.now() + COOLDOWN_MS;
      setCooldownUntil(until);
      storeCooldown(token, until);
    } catch (e) {
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
      const result = await shippingApi.revealCollectionCode(token, revealInput.trim().toUpperCase());
      setCollectionCode(result.collectionCode);
      setPhase('revealed');
    } catch (e) {
      setRevealError((e as ApiError).message || 'That code is invalid or has expired. Request a new one.');
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div data-theme="light" className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Get your collection code</h2>
      <p className="mt-1 text-sm text-slate-600">
        The terminal will ask for this code to confirm it&rsquo;s you before handing over the parcel. No account needed.
      </p>

      {phase === 'revealed' ? (
        collectionCode ? (
          <p className="mt-3 text-center text-3xl font-bold tracking-[0.3em] text-belize-navy">{collectionCode}</p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">No collection code to show for this parcel right now.</p>
        )
      ) : (
        <>
          {phase === 'sent' && (
            <Alert tone="info" className="mt-3">
              If an email is on file for this parcel, we&rsquo;ve sent a short token to it. Check your inbox (and spam
              folder), then enter it below. That emailed token is not your collection code — never give it to a
              terminal clerk. It only unlocks the real code below.
            </Alert>
          )}

          {phase === 'sent' && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Token from your email
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
                {revealing ? 'Checking…' : 'Confirm token'}
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
                ? `You can request another token in ${formatRemaining(cooldownRemaining)}`
                : phase === 'sent'
                  ? 'Resend token'
                  : 'Email me a collection code'}
          </Button>
        </>
      )}
    </div>
  );
}
