'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { jobsApi, type SavedJob } from '../../../../lib/jobs';
import { JobCard } from '../../../../components/jobs/JobCard';
import { Alert, Badge, EmptyState, PageHeader, Spinner, ButtonLink } from '../../../../components/ui';

export default function SavedJobsPage() {
  const [items, setItems] = useState<SavedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    jobsApi
      .savedJobs()
      .then((r) => active && setItems(r.items))
      .catch((e) => active && setError((e as ApiError).message ?? 'Failed to load saved jobs.'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Belize Connect" title="Saved jobs" description="Jobs you've bookmarked to review or apply to later." />

      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No saved jobs yet"
          description="Tap the heart on any job to save it here."
          action={<ButtonLink href="/jobs">Browse jobs</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items?.map((job) => (
            <div key={job.jobId} className="relative">
              {job.closed && (
                <div className="absolute left-3 top-3 z-10">
                  <Badge tone="neutral">Closed</Badge>
                </div>
              )}
              <JobCard job={job} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
