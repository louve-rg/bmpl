'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../lib/api';
import {
  jobsApi,
  type JobQuestion,
  type SeekerResume,
  type ApplicationAnswerInput,
} from '../../lib/jobs';
import { Alert, Button, Field, Input, Label, Select, Spinner, Textarea } from '../ui';

interface AnswerState {
  text: string;
  choices: string[];
}

/**
 * Internal application form used from the job detail page. Collects résumé
 * selection, a cover letter, and typed answers to the job's custom questions.
 * Required questions are enforced client-side too (server also enforces → 400).
 */
export function ApplyForm({
  jobId,
  jobSlug,
  questions,
  onSubmitted,
  onCancel,
}: {
  jobId: string;
  jobSlug: string;
  questions: JobQuestion[];
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const [resumes, setResumes] = useState<SeekerResume[] | null>(null);
  const [resumeId, setResumeId] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    jobsApi
      .getProfile()
      .then((p) => {
        if (!active) return;
        setResumes(p.resumes);
        const primary = p.resumes.find((r) => r.isPrimary) ?? p.resumes[0];
        if (primary) setResumeId(primary.id);
      })
      .catch(() => active && setResumes([]));
    return () => {
      active = false;
    };
  }, []);

  function setText(qid: string, text: string) {
    setAnswers((prev) => ({ ...prev, [qid]: { text, choices: prev[qid]?.choices ?? [] } }));
  }
  function setChoice(qid: string, choice: string) {
    setAnswers((prev) => ({ ...prev, [qid]: { text: '', choices: [choice] } }));
  }
  function toggleChoice(qid: string, choice: string) {
    setAnswers((prev) => {
      const current = prev[qid]?.choices ?? [];
      const next = current.includes(choice) ? current.filter((c) => c !== choice) : [...current, choice];
      return { ...prev, [qid]: { text: '', choices: next } };
    });
  }

  function answerFilled(q: JobQuestion): boolean {
    const a = answers[q.id];
    if (!a) return false;
    if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE') return a.choices.length > 0;
    return a.text.trim().length > 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missing = questions.filter((q) => q.required && !answerFilled(q));
    if (missing.length > 0) {
      setError('Please answer all required questions before submitting.');
      return;
    }
    const payload: ApplicationAnswerInput[] = [];
    for (const q of questions) {
      const a = answers[q.id];
      if (!a) continue;
      if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE') {
        if (a.choices.length > 0) payload.push({ questionId: q.id, choices: a.choices });
      } else if (a.text.trim()) {
        payload.push({ questionId: q.id, text: a.text.trim() });
      }
    }

    setBusy(true);
    try {
      await jobsApi.apply({
        jobId,
        resumeId: resumeId || undefined,
        coverLetter: coverLetter.trim() || undefined,
        answers: payload,
      });
      onSubmitted();
    } catch (err) {
      setError((err as ApiError).message ?? 'Unable to submit your application.');
    } finally {
      setBusy(false);
    }
  }

  if (resumes === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading your profile…
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Résumé" hint="Manage your résumés in your job profile.">
        {resumes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No résumé on file.{' '}
            <Link href="/dashboard/jobs/profile" className="font-medium text-belize-blue hover:underline">
              Upload one
            </Link>{' '}
            or apply without a résumé.
          </p>
        ) : (
          <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">No résumé</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.isPrimary ? ' (primary)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Cover letter (optional)">
        <Textarea
          rows={5}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          placeholder="Tell the employer why you're a great fit…"
        />
      </Field>

      {questions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-belize-navy">Screening questions</h3>
          {questions.map((q) => (
            <QuestionField
              key={q.id}
              q={q}
              value={answers[q.id]}
              onText={(t) => setText(q.id, t)}
              onChoose={(c) => setChoice(q.id, c)}
              onToggle={(c) => toggleChoice(q.id, c)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit application'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function QuestionField({
  q,
  value,
  onText,
  onChoose,
  onToggle,
}: {
  q: JobQuestion;
  value: AnswerState | undefined;
  onText: (t: string) => void;
  onChoose: (c: string) => void;
  onToggle: (c: string) => void;
}) {
  const label = `${q.prompt}${q.required ? ' *' : ''}`;
  const options = q.options ?? [];

  if (q.type === 'LONG_TEXT') {
    return (
      <Field label={label}>
        <Textarea rows={3} value={value?.text ?? ''} onChange={(e) => onText(e.target.value)} required={q.required} />
      </Field>
    );
  }
  if (q.type === 'YES_NO') {
    return (
      <div>
        <Label>{label}</Label>
        <div className="mt-1 flex gap-4">
          {['Yes', 'No'].map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={value?.text === opt}
                onChange={() => onText(opt)}
                className="h-4 w-4 border-slate-300 text-belize-blue focus:ring-belize-accent"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === 'SINGLE_CHOICE') {
    return (
      <div>
        <Label>{label}</Label>
        <div className="mt-1 flex flex-col gap-1.5">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={(value?.choices ?? []).includes(opt)}
                onChange={() => onChoose(opt)}
                className="h-4 w-4 border-slate-300 text-belize-blue focus:ring-belize-accent"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === 'MULTIPLE_CHOICE') {
    return (
      <div>
        <Label>{label}</Label>
        <div className="mt-1 flex flex-col gap-1.5">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={(value?.choices ?? []).includes(opt)}
                onChange={() => onToggle(opt)}
                className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const inputType = q.type === 'NUMBER' ? 'number' : q.type === 'DATE' ? 'date' : 'text';
  return (
    <Field label={label}>
      <Input
        type={inputType}
        value={value?.text ?? ''}
        onChange={(e) => onText(e.target.value)}
        required={q.required}
      />
    </Field>
  );
}
