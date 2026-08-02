'use client';

import { useState } from 'react';
import { JOB_QUESTION_TYPES, type JobQuestionType } from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import { jobsApi, type JobQuestion } from '../../lib/jobs';
import { Alert, Badge, Button, Card, Field, Input, Select } from '../ui';

const TYPE_LABELS: Record<JobQuestionType, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  YES_NO: 'Yes / No',
  SINGLE_CHOICE: 'Single choice',
  MULTIPLE_CHOICE: 'Multiple choice',
  NUMBER: 'Number',
  DATE: 'Date',
};

const NEEDS_OPTIONS = (t: JobQuestionType) => t === 'SINGLE_CHOICE' || t === 'MULTIPLE_CHOICE';

/** Custom screening-question manager for a job (add / remove). */
export function QuestionsManager({ jobId, initial }: { jobId: string; initial: JobQuestion[] }) {
  const [questions, setQuestions] = useState<JobQuestion[]>(initial);
  const [prompt, setPrompt] = useState('');
  const [type, setType] = useState<JobQuestionType>('SHORT_TEXT');
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError('Enter a question prompt.');
      return;
    }
    const options = NEEDS_OPTIONS(type)
      ? optionsText.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined;
    if (NEEDS_OPTIONS(type) && (!options || options.length < 2)) {
      setError('Choice questions need at least two comma-separated options.');
      return;
    }
    setBusy(true);
    try {
      const created = await jobsApi.employer.addQuestion(jobId, {
        prompt: prompt.trim(),
        type,
        required,
        options,
      });
      setQuestions([...questions, created]);
      setPrompt('');
      setOptionsText('');
      setRequired(false);
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not add question.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await jobsApi.employer.deleteQuestion(jobId, id);
      setQuestions(questions.filter((q) => q.id !== id));
    } catch (e) {
      setError((e as ApiError).message ?? 'Could not remove question.');
    }
  }

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="bmpl-eyebrow">Screening questions</h2>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-2">
        {questions.length === 0 && <p className="text-sm text-slate-400">No screening questions yet.</p>}
        {questions.map((q) => (
          <div key={q.id} className="flex items-start justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-medium text-belize-navy">
                {q.prompt} {q.required && <Badge tone="brand">required</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                {TYPE_LABELS[q.type]}
                {q.options?.length ? ` · ${q.options.join(', ')}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => remove(q.id)} className="text-xs font-medium text-red-600 hover:underline">
              Remove
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="space-y-3 border-t border-slate-100 pt-3">
        <Field label="Question prompt">
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. How many years of experience do you have?" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Answer type">
            <Select value={type} onChange={(e) => setType(e.target.value as JobQuestionType)}>
              {JOB_QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pt-7 text-sm text-slate-600">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent" />
            Required
          </label>
        </div>
        {NEEDS_OPTIONS(type) && (
          <Field label="Options (comma-separated)">
            <Input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Option A, Option B, Option C" />
          </Field>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? 'Adding…' : 'Add question'}
        </Button>
      </form>
    </Card>
  );
}
