'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import { Alert, Button } from './ui';

/**
 * The unverified-email warning, with a way OUT of it.
 *
 * The old banner said "check your inbox for the link" and offered nothing if
 * that email never arrived — advice about an email that may not exist. This
 * adds the missing action: POST /auth/resend-verification, which issues a
 * fresh 24-hour link.
 *
 * The endpoint is deliberately enumeration-safe (it reports success whether
 * or not the address exists or is already verified), and this banner keeps
 * that promise: one neutral confirmation, never "sent!" versus "already
 * verified". It is also strictly throttled server-side; the button cools
 * down after a click and a throttle response is shown in the server's own
 * words. No token is ever visible to this component — only {ok} comes back.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function resend() {
    setState('sending');
    setErr(null);
    try {
      await api.post('/auth/resend-verification', { email });
      setState('sent');
    } catch (e) {
      // Most likely the strict throttle; the server's message says so better
      // than a generic failure would.
      setErr((e as ApiError).message ?? 'Could not send a new link just now. Try again in a little while.');
      setState('idle');
    } finally {
      // A brief local cooldown either way, so an impatient click cannot
      // hammer a throttled endpoint.
      setCoolingDown(true);
      timer.current = setTimeout(() => setCoolingDown(false), 30_000);
    }
  }

  return (
    <Alert tone="warning" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Please verify your email to unlock provider features.{' '}
          {state === 'sent'
            ? 'If that address needs verifying, a new link is on its way — it stays valid for 24 hours.'
            : 'Check your inbox for the link.'}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void resend()}
          disabled={state === 'sending' || coolingDown}
        >
          {state === 'sending' ? 'Sending…' : coolingDown ? 'Link requested' : 'Resend verification email'}
        </Button>
      </div>
      {err && <p className="mt-2 text-sm font-medium">{err}</p>}
    </Alert>
  );
}
