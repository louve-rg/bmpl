'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { JOB_APPLICATION_STATUS_LABELS, isActiveApplicationStatus } from '@bmpl/shared';
import { api, type ApiError } from '../../../../../lib/api';
import {
  jobsApi,
  fmtDate,
  fmtDateTime,
  type SeekerApplicationDetail,
} from '../../../../../lib/jobs';
import {
  APPLICATION_STATUS_TONE,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_STATUS_LABELS,
} from '../../../../../components/jobs/status';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../../../../../components/ui';

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [app, setApp] = useState<SeekerApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApp(await jobsApi.application(id));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 404 ? 'Application not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw() {
    setAction(null);
    try {
      await jobsApi.withdraw(id);
      await load();
    } catch (e) {
      setAction((e as ApiError).message ?? 'Could not withdraw.');
    }
  }

  async function messageEmployer() {
    setAction(null);
    try {
      await jobsApi.openApplicationConversation(id);
      router.push('/dashboard/messages');
    } catch (e) {
      setAction((e as ApiError).message ?? 'Could not open the conversation.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/jobs/applications" className="text-sm font-medium text-belize-blue hover:underline">
        ← My applications
      </Link>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : app ? (
        <>
          <PageHeader
            eyebrow={app.company}
            title={app.jobTitle}
            description={`Applied ${fmtDate(app.submittedAt)}`}
            actions={
              <>
                <Link href={`/jobs/${app.jobSlug}`} className="text-sm font-medium text-belize-blue hover:underline">
                  View job
                </Link>
              </>
            }
          />

          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={APPLICATION_STATUS_TONE[app.status]}>{JOB_APPLICATION_STATUS_LABELS[app.status]}</Badge>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={messageEmployer}>
                Message employer
              </Button>
              {isActiveApplicationStatus(app.status) && (
                <Button size="sm" variant="ghost" onClick={withdraw}>
                  Withdraw application
                </Button>
              )}
            </div>
          </div>
          {action && <Alert tone="error">{action}</Alert>}

          {app.interviews.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="text-base font-bold text-belize-navy">Interviews</h2>
              {app.interviews.map((iv, i) => (
                <div key={i} className="rounded-bmpl-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-belize-navy">{fmtDateTime(iv.scheduledAt)}</p>
                    <Badge tone={iv.status === 'CANCELLED' ? 'error' : 'info'}>{INTERVIEW_STATUS_LABELS[iv.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {INTERVIEW_MODE_LABELS[iv.mode]}
                    {iv.location ? ` · ${iv.location}` : ''}
                    {iv.timezone ? ` · ${iv.timezone}` : ''}
                  </p>
                  {iv.notes && <p className="mt-1 text-sm text-slate-600">{iv.notes}</p>}
                </div>
              ))}
            </Card>
          )}

          <Card className="space-y-3 p-5">
            <h2 className="text-base font-bold text-belize-navy">Status history</h2>
            <ol className="space-y-3">
              {app.timeline.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-belize-blue" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-belize-navy">{JOB_APPLICATION_STATUS_LABELS[t.to]}</p>
                    <p className="text-xs text-slate-500">{fmtDateTime(t.at)}</p>
                    {t.note && <p className="mt-0.5 text-sm text-slate-600">{t.note}</p>}
                  </div>
                </li>
              ))}
              {app.timeline.length === 0 && <p className="text-sm text-slate-400">No updates yet.</p>}
            </ol>
          </Card>

          {app.resume && (
            <Card className="p-5">
              <h2 className="text-base font-bold text-belize-navy">Résumé submitted</h2>
              <p className="mt-1 text-sm text-slate-600">{app.resume.label}</p>
            </Card>
          )}

          {app.coverLetter && (
            <Card className="p-5">
              <h2 className="text-base font-bold text-belize-navy">Cover letter</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{app.coverLetter}</p>
            </Card>
          )}

          {app.answers.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="text-base font-bold text-belize-navy">Your answers</h2>
              {app.answers.map((a, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-belize-navy">{a.prompt}</p>
                  <p className="text-sm text-slate-600">{a.choices?.length ? a.choices.join(', ') : a.text || '—'}</p>
                </div>
              ))}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
