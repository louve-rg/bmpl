'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { Button } from '../../../../components/ui';

/**
 * Approve / reject / suspend / restore a vendor, guarded server-side by
 * vendors.moderate. Drawn only for that permission — /me returns the same
 * grant rows the PermissionsGuard evaluates, so what this screen shows and
 * what the API enforces cannot disagree. On any doubt (request fails,
 * field absent) it stays hidden: fail closed.
 */
export function VendorModeration({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [canModerate, setCanModerate] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanModerate((me.adminPermissions ?? []).includes('vendors.moderate')))
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
      await api.post(`/admin/vendors/${id}/${action}`, { note });
      router.refresh();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {canModerate && status === 'PENDING' && (
        <>
          <Button onClick={() => run('approve')} disabled={busy} variant="primary">
            Approve
          </Button>
          <Button onClick={() => run('reject')} disabled={busy} variant="destructive">
            Reject
          </Button>
        </>
      )}
      {canModerate && status === 'APPROVED' && (
        <Button onClick={() => run('suspend')} disabled={busy} variant="destructive">
          Suspend
        </Button>
      )}
      {canModerate && status === 'SUSPENDED' && (
        <Button onClick={() => run('restore')} disabled={busy} variant="primary">
          Restore
        </Button>
      )}
      {status === 'REJECTED' && (
        <p className="text-sm text-slate-500">Awaiting the vendor to revise and resubmit.</p>
      )}
    </div>
  );
}
