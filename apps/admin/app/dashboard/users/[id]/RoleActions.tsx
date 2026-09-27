'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RoleCode } from '@bmpl/shared';
import { api } from '../../../../lib/api';

/**
 * Per-role admin controls: suspend / restore / revoke. Reasons are required.
 * Each control is drawn only for its own permission (roles.suspend/restore/
 * revoke — three different permissions, passed down from the server
 * component that already resolved them from GET /me; see users/[id]/
 * page.tsx). Hidden rather than disabled, and hidden by default if a caller
 * ever forgets to pass one — fail closed.
 */
export function RoleActions({
  userId,
  roleCode,
  status,
  canSuspend = false,
  canRestore = false,
  canRevoke = false,
}: {
  userId: string;
  roleCode: RoleCode;
  status: string;
  canSuspend?: boolean;
  canRestore?: boolean;
  canRevoke?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(kind: 'suspend' | 'restore' | 'revoke') {
    let reason = '';
    if (kind !== 'restore') {
      reason = window.prompt(`Reason to ${kind} this role:`) ?? '';
      if (!reason.trim()) return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/roles/${kind}`, { userId, roleCode, reason, note: reason });
      router.refresh();
    } catch (err) {
      window.alert((err as { message?: string }).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      {status === 'APPROVED' && canSuspend && (
        <ActionBtn label="Suspend" onClick={() => run('suspend')} disabled={busy} />
      )}
      {status === 'SUSPENDED' && canRestore && (
        <ActionBtn label="Restore" onClick={() => run('restore')} disabled={busy} />
      )}
      {['APPROVED', 'SUSPENDED'].includes(status) && canRevoke && (
        <ActionBtn label="Revoke" danger onClick={() => run('revoke')} disabled={busy} />
      )}
    </div>
  );
}

/**
 * Account-level suspend / restore. Each control is drawn only for its own
 * permission (users.suspend / users.restore), passed down the same way as
 * RoleActions above.
 */
export function AccountActions({
  userId,
  status,
  canSuspend = false,
  canRestore = false,
}: {
  userId: string;
  status: string;
  canSuspend?: boolean;
  canRestore?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function suspend() {
    const reason = window.prompt('Reason to suspend this account:') ?? '';
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/users/suspend', { userId, reason });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    try {
      await api.post('/admin/users/restore', { userId });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'SUSPENDED') return canRestore ? <ActionBtn label="Restore account" onClick={restore} disabled={busy} /> : null;
  return canSuspend ? <ActionBtn label="Suspend account" danger onClick={suspend} disabled={busy} /> : null;
}

function ActionBtn({
  label,
  danger,
  onClick,
  disabled,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-bmpl-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        danger
          ? 'border-red-300 text-red-700 hover:bg-red-50'
          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
