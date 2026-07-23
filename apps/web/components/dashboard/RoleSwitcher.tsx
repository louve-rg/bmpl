'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';

/**
 * Role switcher. Only APPROVED roles are offered; switching re-scopes the whole
 * dashboard. The backend independently rejects any attempt to activate a
 * non-approved role, so this control is convenience, not the security boundary.
 */
export function RoleSwitcher({ me }: { me: MeView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const selectable = me.roles.filter((r) => r.isSelectable);

  async function switchTo(roleCode: RoleCode) {
    if (roleCode === me.activeRole || busy) return;
    setBusy(true);
    try {
      await api.post('/roles/switch', { roleCode });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (selectable.length <= 1) {
    return (
      <div className="rounded-lg bg-belize-blue/5 px-3 py-2 text-sm">
        <span className="font-semibold text-belize-navy">
          {me.activeRole ? ROLE_DEFINITIONS[me.activeRole].label : 'Customer'}
        </span>
        <p className="text-xs text-slate-500">Request more roles to unlock the switcher.</p>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        Active role
      </span>
      <select
        value={me.activeRole ?? 'CUSTOMER'}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value as RoleCode)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-belize-navy outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
      >
        {selectable.map((r) => (
          <option key={r.roleCode} value={r.roleCode}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
