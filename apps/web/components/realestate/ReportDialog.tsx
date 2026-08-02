'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PROPERTY_REPORT_REASONS, type PropertyReportReason } from '@bmpl/shared';
import { realEstateApi, PROPERTY_REPORT_REASON_LABELS } from '../../lib/realestate';
import type { ApiError } from '../../lib/api';
import { Alert, Button, Field, Select, Textarea } from '../ui';

/** "Report this listing" disclosure. Guests are routed to login on 401. */
export function ReportDialog({ listingId, slug }: { listingId: string; slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PropertyReportReason>('SCAM');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await realEstateApi.seeker.report(listingId, { reason, note: note.trim() || undefined });
      setDone(true);
      setOpen(false);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/properties/${slug}`)}`);
        return;
      }
      setError(e2.message ?? 'Unable to submit your report.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="text-xs text-slate-500">Thanks — this report was submitted for review.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-slate-500 hover:text-red-600 hover:underline"
      >
        Report this listing
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value as PropertyReportReason)}>
          {PROPERTY_REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {PROPERTY_REPORT_REASON_LABELS[r]}
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
