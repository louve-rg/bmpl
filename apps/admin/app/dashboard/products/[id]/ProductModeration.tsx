'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { Button } from '../../../../components/ui';

/**
 * Approve / reject / suspend / restore a product, guarded server-side by
 * products.moderate. Drawn only for that permission — /me returns the same
 * grant rows the PermissionsGuard evaluates, so what this screen shows and
 * what the API enforces cannot disagree. On any doubt (request fails,
 * field absent) it stays hidden: fail closed.
 */
export function ProductModeration({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [canModerate, setCanModerate] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanModerate((me.adminPermissions ?? []).includes('products.moderate')))
      .catch(() => setCanModerate(false));
  }, []);

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
      {canModerate && status === 'PENDING_REVIEW' && (
        <>
          <Button variant="primary" onClick={() => run('approve')} disabled={busy}>Approve</Button>
          <Button variant="destructive" onClick={() => run('reject')} disabled={busy}>Reject</Button>
        </>
      )}
      {canModerate && status === 'PUBLISHED' && (
        <Button variant="destructive" onClick={() => run('suspend')} disabled={busy}>Suspend</Button>
      )}
      {canModerate && status === 'SUSPENDED' && (
        <Button variant="primary" onClick={() => run('restore')} disabled={busy}>Restore</Button>
      )}
      {(status === 'DRAFT' || status === 'REJECTED' || status === 'ARCHIVED') && (
        <p className="text-sm text-slate-500">No action available in “{status}”. Waiting on the vendor.</p>
      )}
    </div>
  );
}
