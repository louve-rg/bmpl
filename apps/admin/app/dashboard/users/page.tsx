'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RoleCode } from '@bmpl/shared';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { Badge, Button, Input, PageHeader, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  district: string | null;
  roles: Array<{ roleCode: RoleCode; status: string }>;
}
interface SearchResult {
  total: number;
  items: UserRow[];
}

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(q: string, statusFilter?: string | null) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('query', q);
      if (statusFilter) params.set('status', statusFilter);
      setResult(await api.get<SearchResult>(`/admin/users?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }

  // Honor ?status=SUSPENDED (e.g. the dashboard "suspended accounts" card links here).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('status');
    const initial = raw && ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(raw) ? raw : null;
    setStatus(initial);
    void search('', initial);
  }, []);

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Users')}
        eyebrow="Accounts"
        title="Users"
        actions={
          status && (
            <div className="flex items-center gap-2 text-sm">
              <Badge tone="brand">Filtered: {status}</Badge>
              <button
                type="button"
                onClick={() => {
                  setStatus(null);
                  void search(query, null);
                }}
                className="font-medium text-slate-500 hover:text-slate-700"
              >
                Clear filter
              </button>
            </div>
          )
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, status);
        }}
        className="mb-5 flex gap-2"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Searching…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {u.roles.filter((r) => r.status === 'APPROVED').length} approved ·{' '}
                    {u.roles.length} total
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/users/${u.id}`}
                      className="font-semibold text-belize-blue hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
              {result && result.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
