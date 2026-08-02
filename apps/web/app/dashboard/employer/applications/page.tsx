'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  JOB_APPLICATION_STATUSES,
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplicationStatus,
} from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import { jobsApi, fmtDate, type EmployerApplicationRow, type EmployerJobRow } from '../../../../lib/jobs';
import { APPLICATION_STATUS_TONE } from '../../../../components/jobs/status';
import { EmployerGate } from '../../../../components/jobs/EmployerGate';
import { Alert, Badge, EmptyState, PageHeader, Select, Spinner } from '../../../../components/ui';

export default function EmployerApplicationsPage() {
  const searchParams = useSearchParams();
  const [jobId, setJobId] = useState(searchParams.get('jobId') ?? '');
  const [status, setStatus] = useState<JobApplicationStatus | ''>('');
  const [jobs, setJobs] = useState<EmployerJobRow[]>([]);
  const [rows, setRows] = useState<EmployerApplicationRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    jobsApi.employer.jobs().then(setJobs).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await jobsApi.employer.applications({ jobId: jobId || undefined, status: status || undefined }));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.message ?? 'Failed to load.');
    }
  }, [jobId, status]);
  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <EmployerGate />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Employer" title="Applicants" description="Review and progress candidates through your hiring pipeline." />

      <div className="flex flex-wrap gap-3">
        <div className="w-full sm:w-64">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Filter by job">
            <option value="">All jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select value={status} onChange={(e) => setStatus(e.target.value as JobApplicationStatus | '')} aria-label="Filter by status">
            <option value="">All statuses</option>
            {JOB_APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_APPLICATION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {rows === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows && rows.length === 0 ? (
        <EmptyState title="No applicants" description="No applications match these filters yet." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Applied</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-belize-navy">{a.applicantName}</td>
                  <td className="px-4 py-3 text-slate-600">{a.jobTitle}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(a.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={APPLICATION_STATUS_TONE[a.status]}>{JOB_APPLICATION_STATUS_LABELS[a.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/employer/applications/${a.id}`} className="text-xs font-semibold text-belize-blue hover:underline">
                      Review
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
