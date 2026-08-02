'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PROMOTION_REPORT_REASONS, PROMOTION_REPORT_REASON_LABELS, type PromotionReportReason } from '@bmpl/shared';
import { marketingApi } from '../../lib/marketing';
import type { ApiError } from '../../lib/api';
import { Alert, Button, Field, Select, Textarea } from '../ui';

/** "Report this ad" disclosure on a sponsored placement. Guests are routed to login. */
export function ReportPromoDialog({ promotionId }: { promotionId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PromotionReportReason>('MISLEADING');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await marketingApi.report(promotionId, { reason, note: note.trim() || undefined });
      setDone(true);
      setOpen(false);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 401) {
        router.push(`/login?next=${encodeURIComponent(pathname || '/')}`);
        return;
      }
      setError(e2.message ?? 'Unable to submit your report.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="text-[11px] text-slate-400">Thanks — this ad was reported for review.</p>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-medium text-slate-400 hover:text-red-600 hover:underline"
      >
        Report ad
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3 text-left">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value as PromotionReportReason)}>
          {PROMOTION_REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {PROMOTION_REPORT_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Details (optional)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit report'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
