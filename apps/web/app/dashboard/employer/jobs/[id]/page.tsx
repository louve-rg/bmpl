'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  JOB_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  type JobStatus,
} from '@bmpl/shared';
import { type ApiError } from '../../../../../lib/api';
import {
  jobsApi,
  formatSalary,
  locationLabel,
  type EmployerJobDetail,
} from '../../../../../lib/jobs';
import { JOB_STATUS_TONE } from '../../../../../components/jobs/status';
import { EmployerGate } from '../../../../../components/jobs/EmployerGate';
import { EmployerJobForm } from '../../../../../components/jobs/EmployerJobForm';
import { QuestionsManager } from '../../../../../components/jobs/QuestionsManager';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../../../../../components/ui';

const EDITABLE: JobStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];

export default function EditJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<EmployerJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJob(await jobsApi.employer.job(id));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.status === 404 ? 'Job not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(kind: 'submit' | 'close' | 'archive' | 'duplicate') {
    setAction(null);
    try {
      if (kind === 'submit') await jobsApi.employer.submitJob(id);
      else if (kind === 'close') await jobsApi.employer.closeJob(id);
      else if (kind === 'archive') await jobsApi.employer.archiveJob(id);
      else if (kind === 'duplicate') {
        const dup = await jobsApi.employer.duplicateJob(id);
        router.push(`/dashboard/employer/jobs/${dup.id}`);
        return;
      }
      await load();
    } catch (e) {
      setAction((e as ApiError).message ?? 'Action failed.');
    }
  }

  if (forbidden) return <EmployerGate />;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error || !job) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  const editable = EDITABLE.includes(job.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/employer/jobs" className="text-sm font-medium text-belize-blue hover:underline">
        ← Job Listings
      </Link>
      <PageHeader
        eyebrow="Employer"
        title={job.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {job.status === 'PUBLISHED' && (
              <Link href={`/jobs/${job.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
                View public
              </Link>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
        {editable && (
          <Button size="sm" onClick={() => act('submit')}>
            Submit for review
          </Button>
        )}
        {job.status === 'PUBLISHED' && (
          <Button size="sm" variant="outline" onClick={() => act('close')}>
            Close
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => act('duplicate')}>
          Duplicate
        </Button>
        {job.status !== 'ARCHIVED' && (
          <Button size="sm" variant="ghost" onClick={() => act('archive')}>
            Archive
          </Button>
        )}
      </div>
      {action && <Alert tone="error">{action}</Alert>}

      {editable ? (
        <EmployerJobForm initial={job} />
      ) : (
        <Card className="space-y-3 p-5">
          <Alert tone="info">
            This job can only be edited while it is a draft, rejected, or when more information is requested.
          </Alert>
          <div>
            <p className="text-sm text-slate-600">
              {locationLabel(job)} · {EMPLOYMENT_TYPE_LABELS[job.employmentType]}
              {job.workArrangement ? ` · ${WORK_ARRANGEMENT_LABELS[job.workArrangement]}` : ''}
            </p>
            {formatSalary({
              minMinor: job.salaryMinMinor,
              maxMinor: job.salaryMaxMinor,
              period: job.salaryPeriod,
              visibility: job.salaryVisibility,
            }) && (
              <p className="mt-1 text-sm font-semibold text-belize-navy">
                {formatSalary({
                  minMinor: job.salaryMinMinor,
                  maxMinor: job.salaryMaxMinor,
                  period: job.salaryPeriod,
                  visibility: job.salaryVisibility,
                })}
              </p>
            )}
            <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{job.description}</p>
          </div>
        </Card>
      )}

      <QuestionsManager jobId={job.id} initial={job.questions} />
    </div>
  );
}
