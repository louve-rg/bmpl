'use client';

import { useState } from 'react';
import { api } from '../../../../lib/api';

/**
 * Fetches a short-lived signed URL on demand and opens it. Documents are never
 * public — the URL is minted per click and expires quickly (rules #5/#6).
 */
export function DocumentLink({ documentId, label }: { documentId: string; label: string }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>(`/admin/documents/${documentId}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={open}
      disabled={busy}
      className="flex items-center gap-2 rounded-bmpl-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-belize-blue transition hover:border-belize-light hover:bg-belize-blue/5 disabled:opacity-60"
    >
      📎 {label} {busy && <span className="text-xs text-slate-400">opening…</span>}
    </button>
  );
}
