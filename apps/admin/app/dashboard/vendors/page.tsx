'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';

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
      <h1 className="mb-6 text-2xl font-bold text-belize-navy">Vendors</h1>
      <div className="mb-5 flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s || 'ALL'}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              status === s ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
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
