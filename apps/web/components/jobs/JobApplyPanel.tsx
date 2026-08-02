'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';
import type { JobDetail } from '../../lib/jobs';
import { deadlineInfo } from '../../lib/jobs';
import { Alert, Button, ButtonLink, Spinner } from '../ui';
import { ApplyForm } from './ApplyForm';

/**
 * Apply call-to-action for the job detail page. Routes guests to login, opens
 * external/email applications directly, and reveals the internal application
 * form for signed-in seekers.
 */
export function JobApplyPanel({ job }: { job: JobDetail }) {
  const [me, setMe] = useState<MeView | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const deadline = deadlineInfo(job.applicationDeadline);
  const closed = deadline?.closed ?? false;

  useEffect(() => {
    let active = true;
    api
      .get<MeView>('/me')
      .then((m) => active && setMe(m))
      .catch(() => active && setMe(null));
    return () => {
      active = false;
    };
  }, []);

  if (done) {
    return (
      <Alert tone="success" title="Application submitted">
        Track its progress under{' '}
        <Link href="/dashboard/jobs/applications" className="font-semibold underline">
          My Applications
        </Link>
        .
      </Alert>
    );
  }

  if (closed) {
    return <Alert tone="neutral">This job is no longer accepting applications.</Alert>;
  }

  if (me === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (me === null) {
    return (
      <ButtonLink href={`/login?next=${encodeURIComponent(`/jobs/${job.slug}`)}`} size="lg" className="w-full">
        Sign in to apply
      </ButtonLink>
    );
  }

  if (job.applicationMethod === 'EXTERNAL_URL' && job.externalUrl) {
    return (
      <ButtonLink href={job.externalUrl} size="lg" className="w-full">
        Apply on company site ↗
      </ButtonLink>
    );
  }

  if (job.applicationMethod === 'EMAIL' && job.applicationEmail) {
    return (
      <ButtonLink
        href={`mailto:${job.applicationEmail}?subject=${encodeURIComponent(`Application: ${job.title}`)}`}
        size="lg"
        className="w-full"
      >
        Apply by email
      </ButtonLink>
    );
  }

  if (!open) {
    return (
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
        Apply now
      </Button>
    );
  }

  return (
    <ApplyForm
      jobId={job.id}
      jobSlug={job.slug}
      questions={job.questions}
      onSubmitted={() => {
        setDone(true);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}
