'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { Card, PageHeader, StatusBadge, Alert, Spinner, EmptyState } from '../../../../components/ui';

/* --------------------------------------------------------------- helpers */

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* --------------------------------------------------------------- types */

type Scope = 'active' | 'completed';

interface JobSummary {
  id: string;
  status: string;
  statusLabel: string;
  orderNumber: string;
  vendor: string;
  itemCount: number;
  city: string;
  district: string;
  feeMinor: number;
  assignedAt: string | null;
  deliveredAt: string | null;
}

/* ----------------------------------------------------------------- page */

export default function DriverJobsPage() {
  const [scope, setScope] = useState<Scope>('active');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<JobSummary[]>(`/driver/jobs?scope=${scope}`)
      .then((d) => {
        if (!cancelled) setJobs(d ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const tabs: Array<{ value: Scope; label: string }> = [
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="My Deliveries" description="Your assigned delivery jobs." />

      <div className="inline-flex w-full overflow-hidden rounded-bmpl-md border border-slate-200 sm:w-auto" role="group" aria-label="Filter jobs">
        {tabs.map((t, i) => {
          const active = scope === t.value;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => setScope(t.value)}
              className={`flex-1 px-6 py-2.5 text-sm font-semibold transition sm:flex-none ${
                i > 0 ? 'border-l border-slate-200' : ''
              } ${active ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title={scope === 'active' ? 'No active deliveries' : 'No completed deliveries'}
          description={scope === 'active' ? 'New delivery jobs will appear here when they are assigned to you.' : 'Deliveries you complete will appear here.'}
        />
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/dashboard/driver/jobs/${job.id}`} className="block">
                <Card className="p-4 transition hover:border-belize-blue/40 hover:shadow-bmpl-md active:scale-[0.995] sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-sm text-belize-navy">Order #{job.orderNumber}</b>
                        <StatusBadge status={job.status} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-600">{job.vendor}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {job.itemCount} {job.itemCount === 1 ? 'item' : 'items'} · {job.city}
                        {job.district ? `, ${job.district.replace(/_/g, ' ')}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {scope === 'completed' && job.deliveredAt
                          ? `Delivered ${formatDate(job.deliveredAt)}`
                          : job.assignedAt
                            ? `Assigned ${formatDate(job.assignedAt)}`
                            : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-belize-navy">{money(job.feeMinor)}</p>
                      <p className="mt-0.5 text-xs text-slate-400">fee</p>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
