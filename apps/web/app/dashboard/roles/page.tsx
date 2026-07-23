'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { ApplicableRole } from '../../../lib/types';
import { Button } from '../../../components/ui';

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  MORE_INFO_REQUIRED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  REVOKED: 'bg-slate-200 text-slate-700',
};

export default function RolesPage() {
  const [roles, setRoles] = useState<ApplicableRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRoles(await api.get<ApplicableRole[]>('/roles/applicable'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function apply(role: ApplicableRole) {
    setBusy(role.roleCode);
    setMessage(null);
    try {
      await api.post('/roles/applications', { roleCode: role.roleCode, documentKeys: [] });
      setMessage(
        role.requiresApproval
          ? `Your ${role.label} application was submitted for review.`
          : `The ${role.label} role was activated.`,
      );
      await load();
    } catch (err) {
      setMessage((err as { message?: string }).message ?? 'Unable to submit application.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-belize-navy">My Roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Request the provider roles you need. Each is reviewed independently — you keep one account.
        </p>
      </header>

      {message && (
        <div className="mb-5 rounded-xl border border-belize-light bg-belize-blue/5 px-4 py-3 text-sm text-belize-navy">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading roles…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {roles.map((role) => (
            <article key={role.roleCode} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-bold text-belize-navy">{role.label}</h2>
                {role.status && (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      STATUS_STYLES[role.status] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {role.status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">{role.description}</p>
              {role.requiredDocuments.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  Documents required: {role.requiredDocuments.join(', ')}
                </p>
              )}
              <div className="mt-4">
                {role.canApply ? (
                  <Button
                    size="sm"
                    disabled={busy === role.roleCode}
                    onClick={() => apply(role)}
                  >
                    {busy === role.roleCode
                      ? 'Submitting…'
                      : role.requiresApproval
                        ? 'Apply'
                        : 'Activate'}
                  </Button>
                ) : (
                  <span className="text-sm text-slate-400">
                    {role.status === 'APPROVED' ? 'Active' : 'In progress'}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
