'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';

/** Approve / reject / suspend / restore a product (server-guarded by products.moderate). */
export function ProductModeration({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: 'approve' | 'reject' | 'suspend' | 'restore') {
    let note = '';
    if (action === 'reject' || action === 'suspend') {
      note = window.prompt(`Reason to ${action}:`) ?? '';
      if (action === 'reject' && !note.trim()) return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/products/${id}/${action}`, { note });
      router.refresh();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {status === 'PENDING_REVIEW' && (
        <>
          <Btn label="Approve" kind="primary" onClick={() => run('approve')} disabled={busy} />
          <Btn label="Reject" kind="danger" onClick={() => run('reject')} disabled={busy} />
        </>
      )}
      {status === 'PUBLISHED' && <Btn label="Suspend" kind="danger" onClick={() => run('suspend')} disabled={busy} />}
      {status === 'SUSPENDED' && <Btn label="Restore" kind="primary" onClick={() => run('restore')} disabled={busy} />}
      {(status === 'DRAFT' || status === 'REJECTED' || status === 'ARCHIVED') && (
        <p className="text-sm text-slate-500">No action available in “{status}”. Waiting on the vendor.</p>
      )}
    </div>
  );
}

function Btn({ label, onClick, disabled, kind }: { label: string; onClick: () => void; disabled?: boolean; kind: 'primary' | 'danger' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
        kind === 'primary' ? 'bg-belize-blue hover:bg-belize-deep' : 'bg-red-600 hover:bg-red-700'
      }`}
    >
      {label}
    </button>
  );
}
