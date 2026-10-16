'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { Label, Select } from '../ui';

/**
 * Role switcher. Only APPROVED roles are offered; switching re-scopes the whole
 * dashboard. The backend independently rejects any attempt to activate a
 * non-approved role, so this control is convenience, not the security boundary.
 *
 * A refusal is SHOWN, in the server's own words. This stopped being a
 * can't-happen path with BMPL-40: activating a provider-type role now requires
 * a verified email, so an account approved before that rule can legitimately
 * be refused here — silently doing nothing would make an honest gate look
 * like a broken control.
 */
export function RoleSwitcher({ me }: { me: MeView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selectable = me.roles.filter((r) => r.isSelectable);

  async function switchTo(roleCode: RoleCode) {
    if (roleCode === me.activeRole || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/roles/switch', { roleCode });
      router.refresh();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Unable to switch roles right now.');
    } finally {
      setBusy(false);
    }
  }

  if (selectable.length <= 1) {
    return (
      // No hardcoded text-belize-navy/text-slate-500 here (same bug as the
      // dashboard home page's stat cards): this sits directly inside the
      // glass-scoped sidebar now, so it needs to inherit the ambient
      // theme's text color rather than assume a white background.
      <div className="bmpl-nav-item cursor-default">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            {me.activeRole ? ROLE_DEFINITIONS[me.activeRole].label : 'Customer'}
          </span>
          <span className="block text-xs text-[color:var(--bmpl-text-muted)]">Request more roles to unlock the switcher.</span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor="active-role">Active role</Label>
      <Select
        id="active-role"
        value={me.activeRole ?? 'CUSTOMER'}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value as RoleCode)}
        className="min-h-[44px] font-semibold"
      >
        {selectable.map((r) => (
          <option key={r.roleCode} value={r.roleCode}>
            {r.label}
          </option>
        ))}
      </Select>
      {err && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600">
          {err}
        </p>
      )}
    </div>
  );
}
