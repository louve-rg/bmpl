'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';

type Action = 'approve' | 'reject' | 'more-info';

export function ReviewActions({ applicationId, decided }: { applicationId: string; decided: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decided) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        This application has already been decided. See the review history above.
      </p>
    );
  }

  async function submit() {
    if (!action) return;
    if ((action === 'reject' || action === 'more-info') && text.trim().length === 0) {
      setError('A reason / message is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') {
        await api.post('/admin/applications/approve', { applicationId, note: text || undefined });
      } else if (action === 'reject') {
        await api.post('/admin/applications/reject', { applicationId, reason: text });
      } else {
        await api.post('/admin/applications/request-more-info', { applicationId, message: text });
      }
      router.push('/dashboard/applications');
      router.refresh();
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-bold text-belize-navy">Decision</h2>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <ActionTab label="Approve" active={action === 'approve'} onClick={() => setAction('approve')} />
        <ActionTab label="Request more info" active={action === 'more-info'} onClick={() => setAction('more-info')} />
        <ActionTab label="Reject" active={action === 'reject'} onClick={() => setAction('reject')} danger />
      </div>

      {action && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              action === 'approve'
                ? 'Optional note…'
                : action === 'more-info'
                  ? 'Describe what the applicant must provide…'
                  : 'Reason for rejection (shown to the applicant)…'
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="mt-3 rounded-lg bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-belize-deep disabled:opacity-60"
          >
            {busy ? 'Submitting…' : 'Confirm decision'}
          </button>
        </>
      )}
    </div>
  );
}

function ActionTab({
  label,
  active,
  danger,
  onClick,
}: {
  label: string;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? danger
            ? 'border-red-500 bg-red-50 text-red-700'
            : 'border-belize-blue bg-belize-blue/5 text-belize-blue'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
      }`}
    >
      {label}
    </button>
  );
}
