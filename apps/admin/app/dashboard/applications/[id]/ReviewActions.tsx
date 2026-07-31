'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { Alert, Button, Card, Textarea } from '../../../../components/ui';

type Action = 'approve' | 'reject' | 'more-info';

export function ReviewActions({ applicationId, decided }: { applicationId: string; decided: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decided) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        This application has already been decided. See the review history above.
      </div>
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
    <Card className="p-5">
      <h2 className="mb-3 font-bold text-belize-navy">Decision</h2>
      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      <div className="mb-3 flex flex-wrap gap-2">
        <ActionTab label="Approve" active={action === 'approve'} onClick={() => setAction('approve')} />
        <ActionTab label="Request more info" active={action === 'more-info'} onClick={() => setAction('more-info')} />
        <ActionTab label="Reject" active={action === 'reject'} onClick={() => setAction('reject')} danger />
      </div>

      {action && (
        <>
          <Textarea
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
          />
          <Button onClick={submit} disabled={busy} variant={action === 'reject' ? 'destructive' : 'primary'} className="mt-3">
            {busy ? 'Submitting…' : 'Confirm decision'}
          </Button>
        </>
      )}
    </Card>
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
      className={`rounded-bmpl-md border px-3 py-1.5 text-sm font-medium transition ${
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
