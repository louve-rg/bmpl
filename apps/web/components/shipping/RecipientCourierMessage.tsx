'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { shippingApi } from '../../lib/shipping';

/**
 * A linked recipient's own entry point into their courier conversation (Edward
 * req 7, option B). Renders only when the API reports an open conversation; a
 * null answer or any failure renders nothing, so no capability-shaped button
 * appears before a driver has accepted. Client gating is UX only — the server
 * authorizes the read against the session user.
 */
export function RecipientCourierMessage({ reference }: { reference: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .incomingCourierConversation(reference)
      .then((r) => {
        if (!cancelled) setConversationId(r.conversationId);
      })
      .catch(() => {
        if (!cancelled) setConversationId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (!conversationId) return null;

  return (
    <Link
      href={`/dashboard/messages?c=${conversationId}`}
      className="inline-flex min-h-[48px] items-center rounded-bmpl-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-belize-blue shadow-bmpl-sm hover:border-belize-blue/40"
    >
      Message your courier
    </Link>
  );
}
