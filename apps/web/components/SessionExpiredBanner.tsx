'use client';

import { useEffect, useState } from 'react';
import { onSessionExpired } from '../lib/api';

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): lib/api.ts already attempts
 * one silent refresh before any 401 ever reaches a page; this only appears
 * once that has already failed, so it can state the problem with confidence
 * ("your session expired") instead of a generic error.
 *
 * Deliberately NOT a redirect to /login, and deliberately NOT an inline
 * email/password form either (god, 2026-11-16): navigating the current tab
 * away would unmount whatever page the person is on and take their typed
 * work with it -- the one thing this investigation found still survives a
 * failed action today (e.g. apps/admin's WalletOperations.tsx leaves the
 * form exactly as typed on a 401). An inline form avoids that too, but adds
 * a second place that collects a password, which is a bigger change than
 * this problem needs and not one to ship without the owner's sign-off. A
 * link to /login in a new tab gets the same no-navigation, no-lost-work
 * result with no credential handling outside the real login page. Mounted
 * once in the root layout so it can catch an expiry from any page.
 */
export function SessionExpiredBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onSessionExpired(() => setOpen(true));
    return () => onSessionExpired(null);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:justify-end">
      <div data-theme="light" className="w-full max-w-sm rounded-bmpl-xl bg-white p-4 shadow-bmpl-lg" role="alert" aria-live="assertive">
        <p className="text-sm font-semibold text-slate-900">Your session expired</p>
        <p className="mt-1 text-sm text-slate-600">
          Nothing on this page has been lost. Sign in again, then click your action again.
        </p>
        <a
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block w-full rounded-bmpl-md bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700"
        >
          Sign in (opens in a new tab)
        </a>
      </div>
    </div>
  );
}
