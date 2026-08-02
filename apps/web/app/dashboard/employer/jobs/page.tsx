'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { JOB_STATUSES, JOB_STATUS_LABELS, type JobStatus } from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import { jobsApi, fmtDate, type EmployerJobRow } from '../../../../lib/jobs';
import { JOB_STATUS_TONE } from '../../../../components/jobs/status';
import { EmployerGate } from '../../../../components/jobs/EmployerGate';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Spinner } from '../../../../components/ui';

const EDITABLE: JobStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];

export default function EmployerJobsPage() {
  const [rows, setRows] = useState<EmployerJobRow[] | null>(null);
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await jobsApi.employer.jobs(status || undefined));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.message ?? 'Failed to load.');
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'submit' | 'close' | 'archive' | 'duplicate') {
    setAction(null);
    try {
      if (action === 'submit') await jobsApi.employer.submitJob(id);
      else if (action === 'close') await jobsApi.employer.closeJob(id);
      else if (action === 'archive') await jobsApi.employer.archiveJob(id);
      else if (action === 'duplicate') await jobsApi.employer.duplicateJob(id);
      await load();
    } catch (e) {
      setAction((e as ApiError).message ?? 'Action failed.');
    }
  }

  if (forbidden) return <EmployerGate />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Employer"
        title="Jobs"
        description="Create, submit, and manage your job listings."
        actions={
          <ButtonLink href="/dashboard/employer/jobs/new" size="sm">
            + New job
          </ButtonLink>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter:</span>
        <FilterChip label="All" active={status === ''} onClick={() => setStatus('')} />
        {JOB_STATUSES.map((s) => (
          <FilterChip key={s} label={JOB_STATUS_LABELS[s]} active={status === s} onClick={() => setStatus(s)} />
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {action && <Alert tone="error">{action}</Alert>}

      {rows === null && !error && !forbidden ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows && rows.length === 0 ? (
        <EmptyState
          title="No jobs here yet"
          description="Create a job listing to start receiving applications."
          action={<ButtonLink href="/dashboard/employer/jobs/new">+ New job</ButtonLink>}
        />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Applicants</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((j) => (
                <tr key={j.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/employer/jobs/${j.id}`} className="font-medium text-belize-navy hover:text-belize-blue">
                      {j.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={JOB_STATUS_TONE[j.status]}>{JOB_STATUS_LABELS[j.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/employer/applications?jobId=${j.id}`} className="text-belize-blue hover:underline">
                      {j.applications}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{j.applicationDeadline ? fmtDate(j.applicationDeadline) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
                      {EDITABLE.includes(j.status) && (
                        <Link href={`/dashboard/employer/jobs/${j.id}`} className="text-belize-blue hover:underline">
                          Edit
                        </Link>
                      )}
                      {(j.status === 'DRAFT' || j.status === 'REJECTED' || j.status === 'MORE_INFO_REQUIRED') && (
                        <button onClick={() => act(j.id, 'submit')} className="text-emerald-700 hover:underline">
                          Submit
                        </button>
                      )}
                      {j.status === 'PUBLISHED' && (
                        <button onClick={() => act(j.id, 'close')} className="text-slate-500 hover:underline">
                          Close
                        </button>
                      )}
                      <button onClick={() => act(j.id, 'duplicate')} className="text-slate-500 hover:underline">
                        Duplicate
                      </button>
                      {j.status !== 'ARCHIVED' && (
                        <button onClick={() => act(j.id, 'archive')} className="text-red-600 hover:underline">
                          Archive
                        </button>
                      )}
                    </div>
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-belize-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
