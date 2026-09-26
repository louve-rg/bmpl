'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BrandLockup } from '../../../components/Logo';
import { RecipientTracking } from '../../../components/shipping/RecipientTracking';
import { Alert, Button, Spinner } from '../../../components/ui';
import type { ApiError } from '../../../lib/api';
import { shippingApi, type RecipientTrackingView } from '../../../lib/shipping';

/**
 * PUBLIC recipient tracking page — no session required.
 *
 * The sender shares a link like /track/<token>; anyone holding it sees the
 * parcel's status, and nothing the API withheld. It lives outside the auth
 * middleware and links nowhere gated: a recipient may not have — and does not
 * need — an account.
 *
 * A bad, expired or never-existed token all resolve to the SAME neutral
 * "can't find this" message. The API answers one fixed 404 for every miss so a
 * guessed link cannot confirm a real shipment; this page must not undo that by
 * saying anything more specific.
 */
export default function RecipientTrackingPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params.token ?? '');

  const [view, setView] = useState<RecipientTrackingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [claimState, setClaimState] = useState<'idle' | 'claiming' | 'claimed' | 'error'>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await shippingApi.trackPublic(token));
      setNotFound(false);
    } catch {
      // Every failure — a wrong token, an expired one, a network hiccup — shows
      // the same thing. We never distinguish "no such shipment" from "not for
      // you", because the API deliberately does not either.
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Refresh on focus, not on a timer: a parcel's status changes a handful of
  // times over days, and the recipient opens the tab, looks, and leaves.
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  /**
   * "Save to my account" — the deliberate second step BMPL-179 added.
   * Holding the link already showed the status above; this attaches it to a
   * real signed-in account so it shows up again without the link. A 401 means
   * "you need to sign in", not "this failed" — we bounce to login and back
   * rather than showing an error for something that just needs a session.
   */
  const claim = useCallback(async () => {
    setClaimState('claiming');
    setClaimError(null);
    try {
      await shippingApi.claim(token);
      setClaimState('claimed');
    } catch (e) {
      if ((e as ApiError).status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/track/${token}`)}`);
        return;
      }
      setClaimState('error');
      setClaimError((e as ApiError).message || 'Could not save this to your account. Try again in a moment.');
    }
  }, [router, token]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center px-4 py-3">
          <Link href="/" className="rounded-bmpl-md bg-belize-navy px-2 py-1.5" aria-label="Belize Marketplace & Logistics">
            <BrandLockup />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Track a parcel</p>

        {loading && (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        )}

        {!loading && notFound && (
          <div className="mt-6 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-center shadow-bmpl-sm">
            <h1 className="text-lg font-semibold text-slate-900">We couldn&rsquo;t find anything for this link</h1>
            <p className="mt-2 text-sm text-slate-600">
              The tracking link may be mistyped or no longer active. Check that you have the whole link, or ask the person
              who sent the parcel for an up-to-date one.
            </p>
          </div>
        )}

        {!loading && view && (
          <div className="mt-4">
            <RecipientTracking view={view} />

            <div className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
              {claimState === 'claimed' ? (
                <p className="text-sm font-medium text-emerald-700">
                  Saved. This parcel now shows up in your BML account too.
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-700">
                    Save this parcel to your BML account so you can find it again without the link.
                  </p>
                  {claimError && (
                    <Alert tone="warning" className="mt-3">
                      {claimError}
                    </Alert>
                  )}
                  <Button onClick={() => void claim()} disabled={claimState === 'claiming'} className="mt-3 min-h-[44px]">
                    {claimState === 'claiming' ? 'Saving…' : 'Save to my account'}
                  </Button>
                </>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
              This link shows the status of one parcel. It doesn&rsquo;t need an account.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
