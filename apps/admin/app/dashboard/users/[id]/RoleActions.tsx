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

/**
 * TERM-SIM-DESIGNATE: `POST /admin/users/test-flag` already exists, is
 * audited (AdminService.setTestFlag, admin.service.ts) and gated on
 * `users.suspend` — this is the first console control for it; there was
 * none before, on either the admin web app, so designating a simulation
 * account required a raw API call or a database write. `isTest` is the ONLY
 * thing that gates whether an account sees the simulation network
 * (shipment.service.ts), so this does not create a new boundary, it exposes
 * an existing one.
 *
 * Shown plainly rather than behind a toggle with no current-state label —
 * an admin who cannot see which side of the flag an account is on would
 * flip it blind. Gated on `canSetTestFlag`, passed down the same
 * `users.suspend` grant `AccountActions` above already reads from `/me`;
 * that permission is the one the endpoint itself requires, not a new one
 * invented for this screen. (Whether `users.suspend` is the RIGHT permission
 * for this is a separate product question the card deliberately left open —
 * not this control's call to make.)
 */
export function TestFlagControl({
  userId,
  isTest,
  canSetTestFlag = false,
}: {
  userId: string;
  isTest: boolean;
  canSetTestFlag?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !isTest;
    const reason =
      window.prompt(
        next
          ? 'Reason to designate this account as a simulation account:'
          : "Reason to clear this account's simulation designation:",
      ) ?? '';
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/users/test-flag', { userId, isTest: next, reason });
      router.refresh();
    } catch (err) {
      window.alert((err as { message?: string }).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          isTest ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
        }`}
      >
        {isTest ? 'Simulation account' : 'Real account'}
      </span>
      {canSetTestFlag && (
        <ActionBtn
          label={isTest ? 'Clear simulation flag' : 'Designate as simulation'}
          danger={isTest}
          onClick={toggle}
          disabled={busy}
        />
      )}
    </div>
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
      className={`rounded-bmpl-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        danger
          ? 'border-red-300 text-red-700 hover:bg-red-50'
          : 'border-[color:var(--bmpl-border)] text-[color:var(--bmpl-text-muted)] hover:bg-belize-blue/5'
      }`}
    >
      {label}
    </button>
  );
}
