'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { JOB_APPLICATION_STATUS_LABELS } from '@bmpl/shared';
import { api, type ApiError } from '../../../../lib/api';
import { jobsApi, fmtDate, type ApplicationListItem } from '../../../../lib/jobs';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Spinner } from '../../../../components/ui';
import { APPLICATION_STATUS_TONE } from '../../../../components/jobs/status';

export default function MyApplicationsPage() {
  const [items, setItems] = useState<ApplicationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    jobsApi
      .applications()
      .then((r) => active && setItems(r))
      .catch((e) => active && setError((e as ApiError).message ?? 'Failed to load applications.'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Belize Connect" title="My applications" description="Track the status of every job you've applied to." />

      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="When you apply to jobs on Belize Connect they'll appear here."
          action={<ButtonLink href="/jobs">Browse jobs</ButtonLink>}
        />
      ) : (
        <div className="overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Applied</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items?.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/jobs/${a.jobSlug}`} className="font-medium text-belize-navy hover:text-belize-blue">
                      {a.jobTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.company}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(a.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={APPLICATION_STATUS_TONE[a.status]}>{JOB_APPLICATION_STATUS_LABELS[a.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/jobs/applications/${a.id}`} className="text-xs font-semibold text-belize-blue hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
