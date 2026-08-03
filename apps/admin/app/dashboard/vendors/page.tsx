'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { PageHeader, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

interface VendorRow {
  id: string;
  businessName: string;
  slug: string;
  approvalStatus: string;
  storeStatus: string;
  submittedAt: string | null;
  owner: { email: string; firstName: string; lastName: string };
  locationCount: number;
}

const STATUSES = ['', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT'];

export default function VendorsPage() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(s: string) {
    setLoading(true);
    try {
      setRows(await api.get<VendorRow[]>(`/admin/vendors${s ? `?status=${s}` : ''}`));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(status);
  }, [status]);

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Vendors')} eyebrow="Marketplace" title="Vendors" />
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s || 'ALL'}
            onClick={() => setStatus(s)}
            className={`rounded-bmpl-md px-3 py-1.5 text-xs font-semibold transition ${
              status === s
                ? 'bg-belize-blue text-white'
                : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{v.businessName}</p>
                    <p className="text-xs text-slate-500">
                      /{v.slug} · {v.locationCount} location{v.locationCount === 1 ? '' : 's'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {v.owner.firstName} {v.owner.lastName}
                    <br />
                    {v.owner.email}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.approvalStatus} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{v.storeStatus}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/vendors/${v.id}`} className="font-semibold text-belize-blue hover:underline">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                    No vendors in this state.
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
