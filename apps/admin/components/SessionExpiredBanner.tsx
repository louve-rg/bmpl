'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, onSessionExpired, type ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from './ui';

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): lib/api.ts already attempts
 * one silent refresh before any 401 ever reaches a page; this only appears
 * once that has already failed, so it can state the problem with confidence
 * ("your session expired") instead of a generic error.
 *
 * Deliberately NOT a redirect to /login: navigating away would unmount
 * whatever page the person is on and take their typed work with it --
 * WalletOperations.tsx's own test-credit form is the traced case that
 * started this (a 401 there leaves userId/amount/reason exactly as typed).
 * Signing back in here, in place, keeps it that way. Mounted once in the
 * root layout so it can catch an expiry from any console page.
 */
export function SessionExpiredBanner() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    onSessionExpired(() => setOpen(true));
    return () => onSessionExpired(null);
  }, []);

  if (!open) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/login', { email, password });
      setSignedIn(true);
      setEmail('');
      setPassword('');
    } catch (err) {
      setError((err as ApiError).message ?? 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:justify-end">
      <div data-theme="light" className="w-full max-w-sm rounded-bmpl-xl bg-white p-4 shadow-bmpl-lg" role="alert" aria-live="assertive">
        {signedIn ? (
          <>
            <p className="text-sm font-semibold text-slate-900">Signed in again</p>
            <p className="mt-1 text-sm text-slate-600">
              Nothing on this page was lost — pick up where you left off.
            </p>
            <Button className="mt-3 w-full" onClick={() => setOpen(false)}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-900">Your session expired</p>
            <p className="mt-1 text-sm text-slate-600">
              Sign in again to continue — anything you’ve typed on this page is still here.
            </p>
            <form onSubmit={onSubmit} className="mt-3 space-y-2">
              {error && <Alert tone="error">{error}</Alert>}
              <Field label="Email" htmlFor="session-expired-email">
                <Input
                  id="session-expired-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="session-expired-password">
                <Input
                  id="session-expired-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Button type="submit" size="md" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
