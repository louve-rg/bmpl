'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { Button } from '../../../../components/ui';

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
          <Button variant="primary" onClick={() => run('approve')} disabled={busy}>Approve</Button>
          <Button variant="destructive" onClick={() => run('reject')} disabled={busy}>Reject</Button>
        </>
      )}
      {status === 'PUBLISHED' && (
        <Button variant="destructive" onClick={() => run('suspend')} disabled={busy}>Suspend</Button>
      )}
      {status === 'SUSPENDED' && (
        <Button variant="primary" onClick={() => run('restore')} disabled={busy}>Restore</Button>
      )}
      {(status === 'DRAFT' || status === 'REJECTED' || status === 'ARCHIVED') && (
        <p className="text-sm text-slate-500">No action available in “{status}”. Waiting on the vendor.</p>
      )}
    </div>
  );
}
