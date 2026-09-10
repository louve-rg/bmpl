'use client';

import { useEffect, useState } from 'react';
import { recipientTrackingUrl } from '../../lib/recipient-tracking';

/**
 * On the sender's own shipment view: a ready-to-hand-over tracking link for the
 * person the parcel is going to.
 *
 * The sender is the messenger — BML has no channel to the recipient — so the job
 * here is to make the link trivial to pass on: a native share sheet where the
 * device offers one, and a copy button everywhere. The URL is built from the
 * page's own origin so it is correct on preview, production and localhost alike.
 */
export function ShareTrackingLink({ token, reference }: { token: string; reference: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // origin is only known in the browser; build the link after mount.
  useEffect(() => {
    setUrl(recipientTrackingUrl(window.location.origin, token));
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permissions) — the link is on
      // screen and selectable, so the person can still copy it by hand.
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: `Track parcel ${reference}`,
        text: 'You can follow this parcel here:',
        url,
      });
    } catch {
      // The person dismissed the share sheet, or it failed — nothing to do.
    }
  }

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Share tracking with the recipient</h2>
      <p className="mt-1 text-sm text-slate-600">
        Send this link to whoever is receiving the parcel. It shows the delivery status only — no account needed, and none
        of your details.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          readOnly
          value={url}
          aria-label="Recipient tracking link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-h-[44px] flex-1 rounded-bmpl-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
        />
        <div className="flex gap-2">
          {canShare && (
            <button
              type="button"
              onClick={share}
              className="inline-flex min-h-[44px] items-center justify-center rounded-bmpl-md bg-belize-blue px-4 text-sm font-semibold text-white"
            >
              Share
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={!url}
            className="inline-flex min-h-[44px] items-center justify-center rounded-bmpl-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
