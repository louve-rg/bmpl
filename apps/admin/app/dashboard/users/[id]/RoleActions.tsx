'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RoleCode } from '@bmpl/shared';
import { api } from '../../../../lib/api';

/** Per-role admin controls: suspend / restore / revoke. Reasons are required. */
export function RoleActions({
  userId,
  roleCode,
  status,
}: {
  userId: string;
  roleCode: RoleCode;
  status: string;
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
      {status === 'APPROVED' && (
        <ActionBtn label="Suspend" onClick={() => run('suspend')} disabled={busy} />
      )}
      {status === 'SUSPENDED' && (
        <ActionBtn label="Restore" onClick={() => run('restore')} disabled={busy} />
      )}
      {['APPROVED', 'SUSPENDED'].includes(status) && (
        <ActionBtn label="Revoke" danger onClick={() => run('revoke')} disabled={busy} />
      )}
    </div>
  );
}

/** Account-level suspend / restore. */
export function AccountActions({ userId, status }: { userId: string; status: string }) {
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

  return status === 'SUSPENDED' ? (
    <ActionBtn label="Restore account" onClick={restore} disabled={busy} />
  ) : (
    <ActionBtn label="Suspend account" danger onClick={suspend} disabled={busy} />
  );
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
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        danger
          ? 'border-red-300 text-red-700 hover:bg-red-50'
          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
