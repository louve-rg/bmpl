import Link from 'next/link';
import { EMPLOYMENT_TYPE_LABELS, WORK_ARRANGEMENT_LABELS } from '@bmpl/shared';
import { Badge, EmptyState } from '../ui';
import { SaveJobButton } from './SaveJobButton';
import {
  type JobCard as JobCardType,
  formatSalary,
  locationLabel,
  deadlineInfo,
} from '../../lib/jobs';

/** Employment-type + work-arrangement badge pair, shared by cards and detail. */
export function JobBadges({
  employmentType,
  workArrangement,
}: {
  employmentType: JobCardType['employmentType'];
  workArrangement: JobCardType['workArrangement'];
}) {
  return (
    <>
      <Badge tone="brand">{EMPLOYMENT_TYPE_LABELS[employmentType]}</Badge>
      {workArrangement && <Badge tone="neutral">{WORK_ARRANGEMENT_LABELS[workArrangement]}</Badge>}
    </>
  );
}

/** Reusable job card. Optionally shows a Save heart in the corner. */
export function JobCard({ job, showSave = true }: { job: JobCardType; showSave?: boolean }) {
  const salary = formatSalary(job.salary);
  const deadline = deadlineInfo(job.applicationDeadline);
  return (
    <div className="group relative rounded-bmpl-lg border border-slate-200 bg-white p-5 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md">
      {showSave && (
        <div className="absolute right-3 top-3">
          <SaveJobButton jobId={job.id} slug={job.slug} size="sm" />
        </div>
      )}
      <Link href={`/jobs/${job.slug}`} className="block pr-8">
        <h3 className="font-bold text-belize-navy group-hover:text-belize-blue">{job.title}</h3>
        <p className="mt-0.5 text-sm text-slate-600">{job.company.name}</p>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          {locationLabel(job)}
        </span>
        {job.category && <span>{job.category.name}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <JobBadges employmentType={job.employmentType} workArrangement={job.workArrangement} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {salary ? (
          <p className="text-sm font-semibold text-belize-navy">{salary}</p>
        ) : (
          <span className="text-xs text-slate-400">Salary not disclosed</span>
        )}
        {deadline && (
          <Badge tone={deadline.closed ? 'neutral' : deadline.soon ? 'warning' : 'info'}>
            {deadline.label}
          </Badge>
        )}
      </div>
    </div>
  );
}

/** Grid of job cards with a built-in empty state. */
export function JobList({
  jobs,
  showSave = true,
  emptyTitle = 'No jobs found',
  emptyDescription,
}: {
  jobs: JobCardType[];
  showSave?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (jobs.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} showSave={showSave} />
      ))}
    </div>
  );
}
