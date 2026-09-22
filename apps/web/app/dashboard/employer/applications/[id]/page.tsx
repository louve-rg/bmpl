'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  JOB_APPLICATION_STATUS_LABELS,
  JOB_APPLICATION_TRANSITIONS,
  INTERVIEW_MODES,
  type JobApplicationStatus,
  type InterviewMode,
} from '@bmpl/shared';
import { type ApiError } from '../../../../../lib/api';
import { CANDIDATE_VISIBLE_NOTE_LABEL } from '../../../../../lib/candidate-notes';
import { interviewActions } from '../../../../../lib/interview-actions';
import {
  jobsApi,
  fmtDate,
  fmtDateTime,
  type EmployerApplicationDetail,
  type Interview,
} from '../../../../../lib/jobs';
import {
  APPLICATION_STATUS_TONE,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_STATUS_LABELS,
} from '../../../../../components/jobs/status';
import { EmployerGate } from '../../../../../components/jobs/EmployerGate';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../../../../../components/ui';

export default function EmployerApplicantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<EmployerApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApp(await jobsApi.employer.application(id));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.status === 404 ? 'Application not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <EmployerGate />;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error || !app) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/employer/applications" className="text-sm font-medium text-belize-blue hover:underline">
        ← Applicants
      </Link>
      <PageHeader
        eyebrow={app.jobTitle}
        title={app.applicant.name}
        description={`${app.applicant.email} · Applied ${fmtDate(app.submittedAt)}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={APPLICATION_STATUS_TONE[app.status]}>{JOB_APPLICATION_STATUS_LABELS[app.status]}</Badge>
        <ResumeButton id={app.id} hasResume={!!app.resume} />
        <MessageButton id={app.id} onError={setError} router={router} />
      </div>

      <StatusControls app={app} onChanged={load} />
      <NotesEditor app={app} onChanged={load} />
      <ScheduleInterview id={app.id} onChanged={load} />

      {app.interviews.length > 0 && (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-bold text-belize-navy">Interviews</h2>
          {app.interviews.map((iv) => (
            <div key={iv.id} className="rounded-bmpl-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-belize-navy">{fmtDateTime(iv.scheduledAt)}</p>
                <Badge tone={iv.status === 'CANCELLED' ? 'error' : 'info'}>{INTERVIEW_STATUS_LABELS[iv.status]}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {INTERVIEW_MODE_LABELS[iv.mode]}
                {iv.location ? ` · ${iv.location}` : ''}
              </p>
              {iv.notes && <p className="mt-1 text-sm text-slate-600">{iv.notes}</p>}
              <InterviewControls interview={iv} onChanged={load} />
            </div>
          ))}
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
          <h2 className="text-base font-bold text-belize-navy">Screening answers</h2>
          {app.answers.map((a, i) => (
            <div key={i}>
              <p className="text-sm font-medium text-belize-navy">{a.prompt}</p>
              <p className="text-sm text-slate-600">{a.choices?.length ? a.choices.join(', ') : a.text || '—'}</p>
            </div>
          ))}
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-bold text-belize-navy">Status history</h2>
        <ol className="space-y-3">
          {app.timeline.length === 0 && <p className="text-sm text-slate-400">No updates yet.</p>}
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
        </ol>
      </Card>
    </div>
  );
}

function ResumeButton({ id, hasResume }: { id: string; hasResume: boolean }) {
  const [busy, setBusy] = useState(false);
  if (!hasResume) return <span className="text-xs text-slate-400">No résumé submitted</span>;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await jobsApi.employer.resumeUrl(id);
          window.open(url, '_blank', 'noopener');
        } finally {
          setBusy(false);
        }
      }}
    >
      View résumé
    </Button>
  );
}

function MessageButton({
  id,
  onError,
  router,
}: {
  id: string;
  onError: (s: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await jobsApi.employer.openConversation(id);
          router.push('/dashboard/messages');
        } catch (e) {
          onError((e as ApiError).message ?? 'Could not open the conversation.');
        }
      }}
    >
      Message applicant
    </Button>
  );
}

function StatusControls({ app, onChanged }: { app: EmployerApplicationDetail; onChanged: () => void }) {
  const [target, setTarget] = useState<JobApplicationStatus | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = JOB_APPLICATION_TRANSITIONS[app.status] ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!target) {
      setError('Choose a status to move to.');
      return;
    }
    setBusy(true);
    try {
      await jobsApi.employer.setStatus(app.id, { status: target, note: note.trim() || undefined });
      setTarget('');
      setNote('');
      onChanged();
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-bold text-belize-navy">Update status</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {options.length === 0 ? (
        <p className="text-sm text-slate-500">This application is in a final state — no further changes.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Move to">
              <Select value={target} onChange={(e) => setTarget(e.target.value as JobApplicationStatus)}>
                <option value="">Select…</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {JOB_APPLICATION_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={CANDIDATE_VISIBLE_NOTE_LABEL}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Updating…' : 'Update status'}
          </Button>
        </form>
      )}
    </Card>
  );
}

function NotesEditor({ app, onChanged }: { app: EmployerApplicationDetail; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await jobsApi.employer.addNote(app.id, note.trim());
      setNote('');
      onChanged();
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not save note.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-base font-bold text-belize-navy">Private notes</h2>
        <p className="text-xs text-slate-500">Only your team sees these — never shared with the candidate.</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-2">
        {app.employerNotes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
        {app.employerNotes.map((n, i) => (
          <div key={i} className="rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">{n.note}</p>
            <p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.at)}</p>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2 border-t border-slate-100 pt-3">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note…" />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? 'Saving…' : 'Add note'}
        </Button>
      </form>
    </Card>
  );
}

function ScheduleInterview({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [mode, setMode] = useState<InterviewMode>('IN_PERSON');
  const [location, setLocation] = useState('');
  const [timezone, setTimezone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!scheduledAt) {
      setError('Choose a date and time.');
      return;
    }
    setBusy(true);
    try {
      await jobsApi.employer.scheduleInterview(id, {
        scheduledAt: new Date(scheduledAt).toISOString(),
        mode,
        location: location.trim() || undefined,
        timezone: timezone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setScheduledAt('');
      setLocation('');
      setNotes('');
      onChanged();
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not schedule interview.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-belize-navy">Schedule an interview</h2>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Schedule
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {open && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date & time">
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </Field>
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
                {INTERVIEW_MODES.map((m) => (
                  <option key={m} value={m}>
                    {INTERVIEW_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location / link (optional)">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Timezone (optional)">
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/Belize" />
            </Field>
          </div>
          {/* This note is serialized into the APPLICANT's view of the
              interview — it is a message to them, and the label must say so.
              Candid text belongs in the Private notes card. (BMPL-145) */}
          <Field label={CANDIDATE_VISIBLE_NOTE_LABEL}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Scheduling…' : 'Confirm interview'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/**
 * The verbs an interview was missing (BMPL-150): the console could schedule
 * one but never complete, cancel or move it — the CANCELLED badge existed
 * with nothing able to set it. Complete/Cancel post the status directly;
 * Reschedule opens an inline form and the SERVER derives the RESCHEDULED
 * status from the new time (no client-side transition rules — finished
 * interviews simply offer no controls, and refusals are shown verbatim).
 * Every change notifies the applicant ("Interview updated"), so these are
 * deliberate buttons, not quiet edits.
 */
function InterviewControls({ interview, onChanged }: { interview: Interview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [mode, setMode] = useState<InterviewMode>(interview.mode);
  const [location, setLocation] = useState(interview.location ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = interviewActions(interview.status);
  if (actions.length === 0) return null;

  async function run(patch: Parameters<typeof jobsApi.employer.updateInterview>[1], verb: string) {
    setBusy(verb);
    setError(null);
    try {
      await jobsApi.employer.updateInterview(interview.id, patch);
      setOpen(false);
      onChanged();
    } catch (e) {
      setError((e as ApiError).message ?? 'Could not update the interview.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run({ status: 'COMPLETED' }, 'complete')}>
          {busy === 'complete' ? 'Saving…' : 'Mark completed'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run({ status: 'CANCELLED' }, 'cancel')}>
          {busy === 'cancel' ? 'Saving…' : 'Cancel interview'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setOpen((v) => !v)}>
          {open ? 'Keep current time' : 'Reschedule'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="New date & time">
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {INTERVIEW_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location / link (optional)">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <div className="sm:col-span-3">
            <Button
              size="sm"
              disabled={busy !== null || !scheduledAt}
              onClick={() =>
                void run(
                  { scheduledAt: new Date(scheduledAt).toISOString(), mode, location: location.trim() || null },
                  'reschedule',
                )
              }
            >
              {busy === 'reschedule' ? 'Saving…' : 'Confirm new time'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
