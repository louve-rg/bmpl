'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DISTRICT_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  EDUCATION_LEVEL_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  SALARY_PERIOD_LABELS,
  type District,
  type EmploymentType,
  type WorkArrangement,
  type ExperienceLevel,
  type EducationLevel,
  type JobStatus,
  type SalaryPeriod,
  type JobReportReason,
  type JobReportStatus,
} from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/**
 * Belize Connect (Jobs) admin console — M24. Client shapes mirror the documented
 * GET /admin/jobs* responses. Money is in MINOR units (BZD cents); labels are
 * imported from @bmpl/shared so admin/web/api never drift.
 */

type ListState = 'loading' | 'ready' | 'error' | 'forbidden';

interface JobSalary {
  minMinor: number | null;
  maxMinor: number | null;
  period: string | null;
  visibility: string;
}

interface JobListItem {
  id: string;
  title: string;
  slug: string;
  status: JobStatus;
  company: string;
  employmentType: string;
  workArrangement: string;
  district: string | null;
  city: string | null;
  salary: JobSalary | null;
  applicationCount: number;
  reportCount: number;
  moderationReason: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface JobQuestion {
  id: string;
  prompt: string;
  type: string;
  required: boolean;
  options: string[];
}

interface JobDetail {
  id: string;
  title: string;
  slug: string;
  status: JobStatus;
  company: { name: string; slug: string };
  category: { name: string; slug: string } | null;
  employmentType: string;
  workArrangement: string;
  district: string | null;
  city: string | null;
  remoteEligible: boolean;
  salary: JobSalary | null;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  experienceLevel: string | null;
  educationLevel: string | null;
  openings: number | null;
  startDate: string | null;
  applicationDeadline: string | null;
  applicationMethod: string | null;
  externalUrl: string | null;
  applicationEmail: string | null;
  skills: Array<{ name: string; required: boolean }>;
  benefits: string[];
  questions: JobQuestion[];
  moderationReason: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface JobReportItem {
  id: string;
  jobId: string;
  reason: JobReportReason;
  note: string | null;
  status: JobReportStatus;
  createdAt: string;
  job: { id: string; title: string; slug: string; status: JobStatus };
}

interface EmployerListItem {
  id: string;
  companyName: string;
  slug: string;
  industry: string | null;
  district: string | null;
  approvalStatus: string;
  jobCount: number;
  createdAt: string;
}

interface EmployerDetail extends EmployerListItem {
  description?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  jobsByStatus: Array<{ status: string; count: number }>;
}

interface JobCategory {
  id: string;
  name: string;
  slug: string;
  isVisible: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface JobAnalytics {
  activeJobs: number;
  moderationBacklog: number;
  openReports: number;
  applications: number;
  hires: number;
  applicationConversion: number;
  approvedEmployers: number;
  byCategory: Array<{ category: string; count: number }>;
  byDistrict: Array<{ district: string; count: number }>;
}

type ModerateAction = 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'UNPUBLISH' | 'SUSPEND' | 'ARCHIVE';
type Tab = 'moderation' | 'reports' | 'employers' | 'categories' | 'analytics';

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function num(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Minor units (cents) → BZD dollars string. */
function moneyMinor(minor: number): string {
  return `BZD ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatSalary(s: JobSalary | null): string | null {
  if (!s || s.visibility === 'HIDDEN') return null;
  const period = s.period ? ` ${SALARY_PERIOD_LABELS[s.period as SalaryPeriod] ?? ''}`.trimEnd() : '';
  if (s.minMinor != null && s.maxMinor != null && s.maxMinor !== s.minMinor) {
    return `${moneyMinor(s.minMinor)} – ${moneyMinor(s.maxMinor)}${period}`;
  }
  const single = s.minMinor ?? s.maxMinor;
  if (single == null) return null;
  return `${moneyMinor(single)}${period}`;
}

function jobStatusLabel(s: string): string {
  return JOB_STATUS_LABELS[s as JobStatus] ?? s.replace(/_/g, ' ');
}

function employmentLabel(s: string): string {
  return EMPLOYMENT_TYPE_LABELS[s as EmploymentType] ?? s.replace(/_/g, ' ');
}

function arrangementLabel(s: string): string {
  return WORK_ARRANGEMENT_LABELS[s as WorkArrangement] ?? s;
}

function districtLabel(s: string | null): string | null {
  if (!s) return null;
  return DISTRICT_LABELS[s as District] ?? s.replace(/_/g, ' ');
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'moderation', label: 'Job moderation' },
  { key: 'reports', label: 'Reports' },
  { key: 'employers', label: 'Employers' },
  { key: 'categories', label: 'Categories' },
  { key: 'analytics', label: 'Analytics' },
];

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('moderation');

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Jobs')}
        eyebrow="Belize Connect"
        title="Jobs moderation & operations"
        description="Moderate job listings, resolve community reports, manage employers and categories, and track Belize Connect performance."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Belize Connect views">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-belize-blue text-white shadow-bmpl-sm'
                  : 'border border-slate-300 text-belize-navy hover:border-belize-blue hover:bg-belize-blue/5'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'moderation' && <ModerationTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'employers' && <EmployersTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Job moderation queue                                                */
/* ------------------------------------------------------------------ */

const STATUS_OPTIONS: Array<{ value: JobStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] })),
];

function ModerationTab() {
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [items, setItems] = useState<JobListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (reportedOnly) params.set('reported', 'true');
      const qs = params.toString();
      const rows = await api.get<JobListItem[]>(`/admin/jobs${qs ? `?${qs}` : ''}`);
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status, reportedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const onModerated = useCallback((updated: JobDetail) => {
    setItems((prev) =>
      prev.map((j) => (j.id === updated.id ? { ...j, status: updated.status, moderationReason: updated.moderationReason } : j)),
    );
    setNotice(`Job "${updated.title}" set to ${jobStatusLabel(updated.status)}.`);
  }, []);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>jobs.read</code> permission required to view the moderation queue.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="job-status">
            <Select id="job-status" value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm font-medium text-belize-navy">
          <input
            type="checkbox"
            checked={reportedOnly}
            onChange={(e) => setReportedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue"
          />
          Reported only
        </label>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="rounded-bmpl-xl border border-slate-200 bg-white">
          {listState === 'loading' ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading jobs…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load jobs.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No jobs" description="No jobs match the current filters." />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((j) => {
                const active = j.id === selectedId;
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(j.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                        active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{j.title}</span>
                        <StatusBadge status={j.status} />
                      </div>
                      <div className="truncate text-xs text-slate-500">{j.company}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <span>{employmentLabel(j.employmentType)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {num(j.applicationCount)} {j.applicationCount === 1 ? 'application' : 'applications'}
                        </span>
                        {j.reportCount > 0 && (
                          <Badge tone="error">
                            {num(j.reportCount)} {j.reportCount === 1 ? 'report' : 'reports'}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId ? (
          <JobDetailPanel key={selectedId} id={selectedId} onModerated={onModerated} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No job selected" description="Choose a job from the list to review its full content." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

const REASON_REQUIRED: Record<ModerateAction, boolean> = {
  APPROVE: false,
  REJECT: true,
  REQUEST_INFO: true,
  UNPUBLISH: false,
  SUSPEND: false,
  ARCHIVE: false,
};

const ACTION_LABELS: Record<ModerateAction, string> = {
  APPROVE: 'Approve & publish',
  REJECT: 'Reject',
  REQUEST_INFO: 'Request info',
  UNPUBLISH: 'Unpublish',
  SUSPEND: 'Suspend',
  ARCHIVE: 'Archive',
};

function availableActions(status: JobStatus): ModerateAction[] {
  const reviewable = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  const actions: ModerateAction[] = [];
  if (reviewable) actions.push('APPROVE', 'REQUEST_INFO', 'REJECT');
  if (status === 'PUBLISHED') actions.push('UNPUBLISH');
  if (status !== 'SUSPENDED' && status !== 'ARCHIVED') actions.push('SUSPEND');
  if (status !== 'ARCHIVED') actions.push('ARCHIVE');
  return actions;
}

function JobDetailPanel({ id, onModerated }: { id: string; onModerated: (j: JobDetail) => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [pending, setPending] = useState<ModerateAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<JobDetail>(`/admin/jobs/${id}`);
      setDetail(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: ModerateAction) {
    const trimmed = reason.trim();
    if (REASON_REQUIRED[action] && !trimmed) {
      setError('A reason is required for this action.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<JobDetail>(`/admin/jobs/${id}/moderate`, {
        action,
        ...(trimmed ? { reason: trimmed } : {}),
      });
      setDetail(updated);
      setPending(null);
      setReason('');
      onModerated(updated);
    } catch (err) {
      const s = apiStatus(err);
      setError(
        s === 403
          ? "You don't have the jobs.moderate permission."
          : (typeof err === 'object' && err !== null && (err as ApiError).message) || 'Action failed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading job…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="You don't have permission">
          You do not have the <code>jobs.read</code> permission required to view this job.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this job.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const salary = formatSalary(detail.salary);
  const actions = availableActions(detail.status);

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-belize-navy">{detail.title}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{detail.company.name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{employmentLabel(detail.employmentType)}</Badge>
          <Badge tone="neutral">{arrangementLabel(detail.workArrangement)}</Badge>
          {detail.category && <Badge tone="info">{detail.category.name}</Badge>}
          {districtLabel(detail.district) && <Badge tone="neutral">{districtLabel(detail.district)}</Badge>}
          {detail.remoteEligible && <Badge tone="success">Remote eligible</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {salary && <span className="font-medium text-belize-navy">{salary}</span>}
          {detail.city && <span>{detail.city}</span>}
          {detail.openings != null && <span>{num(detail.openings)} opening(s)</span>}
          {detail.experienceLevel && <span>{EXPERIENCE_LEVEL_LABELS[detail.experienceLevel as ExperienceLevel]}</span>}
          {detail.educationLevel && <span>{EDUCATION_LEVEL_LABELS[detail.educationLevel as EducationLevel]}</span>}
          {detail.applicationDeadline && <span>Closes {new Date(detail.applicationDeadline).toLocaleDateString()}</span>}
          <span>Created {relativeTime(detail.createdAt)}</span>
        </div>
      </div>

      {detail.moderationReason && (
        <div className="p-4 pb-0">
          <Alert tone="warning" title="Moderation reason">
            {detail.moderationReason}
          </Alert>
        </div>
      )}

      <div className="space-y-4 p-4">
        <ExpandableText label="Description" text={detail.description} />
        {detail.responsibilities && <ExpandableText label="Responsibilities" text={detail.responsibilities} />}
        {detail.requirements && <ExpandableText label="Requirements" text={detail.requirements} />}
        {detail.preferredQualifications && (
          <ExpandableText label="Preferred qualifications" text={detail.preferredQualifications} />
        )}

        {detail.skills.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Skills</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.skills.map((s) => (
                <Badge key={s.name} tone={s.required ? 'brand' : 'neutral'}>
                  {s.name}
                  {s.required && <span className="text-belize-blue">*</span>}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.benefits.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Benefits</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.benefits.map((b) => (
                <Badge key={b} tone="success">
                  {b}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.questions.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Screening questions</p>
            <ul className="space-y-1.5">
              {detail.questions.map((q) => (
                <li key={q.id} className="rounded-bmpl-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-belize-navy">
                  <span>{q.prompt}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {q.type.replace(/_/g, ' ').toLowerCase()}
                    {q.required ? ' · required' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {detail.applicationMethod && <span>Apply via: {detail.applicationMethod.replace(/_/g, ' ').toLowerCase()}</span>}
          {detail.externalUrl && (
            <a href={detail.externalUrl} target="_blank" rel="noopener noreferrer" className="text-belize-blue underline">
              External link
            </a>
          )}
          {detail.applicationEmail && <span>{detail.applicationEmail}</span>}
        </div>
      </div>

      {error && (
        <div className="px-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Moderation actions */}
      <div className="border-t border-slate-100 p-4">
        {actions.length === 0 ? (
          <p className="text-sm text-slate-400">No moderation actions available for this status.</p>
        ) : pending ? (
          <div className="space-y-2">
            <Field
              label={REASON_REQUIRED[pending] ? 'Reason (required)' : 'Reason (optional)'}
              htmlFor={`reason-${id}`}
              hint="Shared with the employer in the moderation notice. Up to 1000 characters."
            >
              <Textarea
                id={`reason-${id}`}
                rows={2}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={REASON_REQUIRED[pending] ? 'Explain why…' : 'Add an optional reason…'}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={pending === 'REJECT' || pending === 'SUSPEND' ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void submit(pending)}
              >
                {busy ? (
                  <>
                    <Spinner className="h-4 w-4" /> Working…
                  </>
                ) : (
                  `Confirm ${ACTION_LABELS[pending].toLowerCase()}`
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setReason('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'APPROVE' ? 'primary' : a === 'REJECT' || a === 'SUSPEND' ? 'destructive' : 'outline'}
                onClick={() => {
                  setPending(a);
                  setReason('');
                  setError(null);
                }}
              >
                {ACTION_LABELS[a]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandableText({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 320;
  const shown = expanded || !long ? text : `${text.slice(0, 320)}…`;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-belize-navy">{shown}</p>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold text-belize-blue underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports queue                                                       */
/* ------------------------------------------------------------------ */

const REPORT_STATUS_OPTIONS: Array<{ value: JobReportStatus; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACTIONED', label: 'Actioned' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

function ReportsTab() {
  const [status, setStatus] = useState<JobReportStatus>('OPEN');
  const [items, setItems] = useState<JobReportItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const rows = await api.get<JobReportItem[]>(`/admin/jobs/reports?status=${status}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onResolved = useCallback((reportId: string, resolvedStatus: 'ACTIONED' | 'DISMISSED') => {
    setItems((prev) => prev.filter((r) => r.id !== reportId));
    setNotice(`Report ${resolvedStatus === 'ACTIONED' ? 'actioned' : 'dismissed'}.`);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Report status" htmlFor="report-status">
            <Select id="report-status" value={status} onChange={(e) => setStatus(e.target.value as JobReportStatus)}>
              {REPORT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {listState === 'forbidden' ? (
        <Alert tone="warning" title="You don't have permission">
          You do not have the <code>jobs.read</code> permission required to view reports.
        </Alert>
      ) : listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading reports…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load reports.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No reports" description={`No ${status.toLowerCase()} reports to show.`} />
      ) : (
        <ul className="space-y-4">
          {items.map((rep) => (
            <ReportCard key={rep.id} report={rep} resolvable={status === 'OPEN'} onResolved={onResolved} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({
  report,
  resolvable,
  onResolved,
}: {
  report: JobReportItem;
  resolvable: boolean;
  onResolved: (id: string, status: 'ACTIONED' | 'DISMISSED') => void;
}) {
  const [pending, setPending] = useState<'ACTIONED' | 'DISMISSED' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(resolveStatus: 'ACTIONED' | 'DISMISSED') {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await api.post<{ ok: true }>(`/admin/jobs/reports/${report.id}/resolve`, {
        status: resolveStatus,
        ...(trimmed ? { note: trimmed } : {}),
      });
      onResolved(report.id, resolveStatus);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the jobs.moderate permission." : 'Action failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="error">{report.reason.replace(/_/g, ' ')}</Badge>
          <StatusBadge status={report.status} />
        </div>
        <span className="shrink-0 text-xs text-slate-400">{relativeTime(report.createdAt)}</span>
      </div>

      {report.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{report.note}</p>}

      <div className="mt-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-belize-navy">{report.job.title}</span>
          <StatusBadge status={report.job.status} />
        </div>
        <p className="text-xs text-slate-400">Listing #{report.job.id}</p>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {resolvable && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {pending ? (
            <div className="space-y-2">
              <Field label="Optional note" htmlFor={`note-${report.id}`} hint="Optional free text, up to 1000 characters.">
                <Textarea
                  id={`note-${report.id}`}
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for this resolution (optional)…"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={pending === 'ACTIONED' ? 'primary' : 'outline'}
                  disabled={busy}
                  onClick={() => void submit(pending)}
                >
                  {busy ? (
                    <>
                      <Spinner className="h-4 w-4" /> Working…
                    </>
                  ) : pending === 'ACTIONED' ? (
                    'Confirm action'
                  ) : (
                    'Confirm dismiss'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setNote('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setPending('ACTIONED')}>
                Action
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPending('DISMISSED')}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Employers                                                           */
/* ------------------------------------------------------------------ */

const EMPLOYER_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
];

function EmployersTab() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<EmployerListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const qs = status ? `?status=${status}` : '';
      const rows = await api.get<EmployerListItem[]>(`/admin/jobs/employers${qs}`);
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = useCallback(
    (updated: EmployerDetail) => {
      setItems((prev) => prev.map((e) => (e.id === updated.id ? { ...e, approvalStatus: updated.approvalStatus } : e)));
      setNotice(`${updated.companyName} is now ${jobStatusLabel(updated.approvalStatus)}.`);
    },
    [],
  );

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>employers.read</code> permission required to view employers.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" title="About employer moderation">
        Initial <strong>employer role approval</strong> is handled in the{' '}
        <a href="/dashboard/applications" className="font-semibold underline">
          Applications
        </a>{' '}
        role-application queue. This area covers company suspend / restore, which takes their live listings offline.
      </Alert>

      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Approval status" htmlFor="emp-status">
            <Select id="emp-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {EMPLOYER_STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="rounded-bmpl-xl border border-slate-200 bg-white">
          {listState === 'loading' ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading employers…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load employers.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No employers" description="No employers match the current filter." />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((e) => {
                const active = e.id === selectedId;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                        active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{e.companyName}</span>
                        <StatusBadge status={e.approvalStatus} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        {e.industry && <span>{e.industry}</span>}
                        {districtLabel(e.district) && <span>{districtLabel(e.district)}</span>}
                        <span aria-hidden>·</span>
                        <span>
                          {num(e.jobCount)} {e.jobCount === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId ? (
          <EmployerDetailPanel key={selectedId} id={selectedId} onChanged={onChanged} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No employer selected" description="Choose an employer to view details." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function EmployerDetailPanel({ id, onChanged }: { id: string; onChanged: (e: EmployerDetail) => void }) {
  const [detail, setDetail] = useState<EmployerDetail | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [pending, setPending] = useState<'suspend' | 'restore' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<EmployerDetail>(`/admin/jobs/employers/${id}`);
      setDetail(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(kind: 'suspend' | 'restore') {
    setBusy(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const updated =
        kind === 'suspend'
          ? await api.post<EmployerDetail>(`/admin/jobs/employers/${id}/suspend`, trimmed ? { reason: trimmed } : {})
          : await api.post<EmployerDetail>(`/admin/jobs/employers/${id}/restore`);
      setDetail(updated);
      setPending(null);
      setReason('');
      onChanged(updated);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the employers.moderate permission." : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading employer…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="You don't have permission">
          You do not have permission to view this employer.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this employer.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const suspended = detail.approvalStatus === 'SUSPENDED';

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-belize-navy">{detail.companyName}</h2>
          <StatusBadge status={detail.approvalStatus} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {detail.industry && <span>{detail.industry}</span>}
          {districtLabel(detail.district) && <span>{districtLabel(detail.district)}</span>}
          {detail.contactEmail && <span>{detail.contactEmail}</span>}
          {detail.website && (
            <a href={detail.website} target="_blank" rel="noopener noreferrer" className="text-belize-blue underline">
              Website
            </a>
          )}
          <span>Joined {relativeTime(detail.createdAt)}</span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {detail.description && <ExpandableText label="About" text={detail.description} />}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Listings by status ({num(detail.jobCount)} total)
          </p>
          {detail.jobsByStatus.length === 0 ? (
            <p className="text-sm text-slate-400">No job listings yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.jobsByStatus.map((s) => (
                <span
                  key={s.status}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-belize-navy"
                >
                  {jobStatusLabel(s.status)}
                  <span className="font-semibold">{num(s.count)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="border-t border-slate-100 p-4">
        {pending ? (
          <div className="space-y-2">
            {pending === 'suspend' && (
              <Field label="Reason (optional)" htmlFor={`emp-reason-${id}`} hint="Shared with the employer in the notice.">
                <Textarea
                  id={`emp-reason-${id}`}
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Add an optional reason…"
                />
              </Field>
            )}
            <p className="text-sm text-slate-500">
              {pending === 'suspend'
                ? 'Suspending takes all of this employer’s published listings offline.'
                : 'Restore this employer to Approved. Previously suspended listings stay suspended until re-published.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={pending === 'suspend' ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void submit(pending)}
              >
                {busy ? (
                  <>
                    <Spinner className="h-4 w-4" /> Working…
                  </>
                ) : pending === 'suspend' ? (
                  'Confirm suspend'
                ) : (
                  'Confirm restore'
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setReason('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {suspended ? (
              <Button size="sm" onClick={() => setPending('restore')}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => setPending('suspend')}>
                Suspend
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function CategoriesTab() {
  const [items, setItems] = useState<JobCategory[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const rows = await api.get<JobCategory[]>('/admin/jobs/categories');
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCategory() {
    const name = newName.trim();
    if (name.length < 2) {
      setError('Category name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.post<JobCategory>('/admin/jobs/categories', {
        name,
        sortOrder: items.length,
      });
      setItems((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
      setNewName('');
      setNotice(`Category "${created.name}" created.`);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the job_categories.manage permission." : 'Could not create category.');
    } finally {
      setCreating(false);
    }
  }

  // updateCategory returns the FULL refreshed list (per API contract).
  const onUpdated = useCallback((rows: JobCategory[], message: string) => {
    setItems(rows);
    setNotice(message);
  }, []);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>jobs.read</code> permission required to view categories.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-belize-navy">Add category</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field label="Name" htmlFor="new-category">
              <Input
                id="new-category"
                value={newName}
                maxLength={80}
                placeholder="e.g. Hospitality"
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
          </div>
          <Button size="sm" disabled={creating || newName.trim().length < 2} onClick={() => void createCategory()}>
            {creating ? (
              <>
                <Spinner className="h-4 w-4" /> Adding…
              </>
            ) : (
              'Add category'
            )}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </div>

      {listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading categories…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load categories.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No categories" description="Create the first job category above." />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <CategoryRow key={c.id} category={c} onUpdated={onUpdated} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  onUpdated,
}: {
  category: JobCategory;
  onUpdated: (rows: JobCategory[], message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { name: string; isVisible?: boolean; sortOrder?: number }, message: string) {
    setBusy(true);
    setError(null);
    try {
      const rows = await api.patch<JobCategory[]>(`/admin/jobs/categories/${category.id}`, body);
      onUpdated(rows, message);
      setEditing(false);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the job_categories.manage permission." : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    const order = Number.parseInt(sortOrder, 10);
    await patch(
      { name: trimmed, isVisible: category.isVisible, sortOrder: Number.isFinite(order) ? order : category.sortOrder },
      `Category "${trimmed}" updated.`,
    );
  }

  async function toggleVisibility() {
    await patch(
      { name: category.name, isVisible: !category.isVisible, sortOrder: category.sortOrder },
      `Category "${category.name}" ${category.isVisible ? 'hidden' : 'made visible'}.`,
    );
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Field label="Name" htmlFor={`cat-name-${category.id}`}>
                <Input id={`cat-name-${category.id}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <div className="w-28">
              <Field label="Sort order" htmlFor={`cat-sort-${category.id}`}>
                <Input
                  id={`cat-sort-${category.id}`}
                  type="number"
                  min={0}
                  max={9999}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? (
                <>
                  <Spinner className="h-4 w-4" /> Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setSortOrder(String(category.sortOrder));
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-belize-navy">{category.name}</span>
            <Badge tone={category.isVisible ? 'success' : 'neutral'}>{category.isVisible ? 'Visible' : 'Hidden'}</Badge>
            <span className="text-xs text-slate-400">Order {category.sortOrder}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleVisibility()}>
              {category.isVisible ? 'Hide' : 'Show'}
            </Button>
          </div>
        </div>
      )}
      {!editing && error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

function AnalyticsTab() {
  const [data, setData] = useState<JobAnalytics | null>(null);
  const [state, setState] = useState<ListState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<JobAnalytics>('/admin/jobs/analytics');
      setData(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>jobs.read</code> permission required to view analytics.
      </Alert>
    );
  }
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading analytics…
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <Alert tone="error">
        Could not load analytics.{' '}
        <button type="button" onClick={() => void load()} className="font-semibold underline">
          Retry
        </button>
      </Alert>
    );
  }

  const kpis: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Active jobs', value: num(data.activeJobs), hint: 'Published listings' },
    { label: 'Moderation backlog', value: num(data.moderationBacklog), hint: 'Submitted + under review' },
    { label: 'Open reports', value: num(data.openReports) },
    { label: 'Applications', value: num(data.applications) },
    { label: 'Hires', value: num(data.hires) },
    { label: 'Conversion', value: `${data.applicationConversion}%`, hint: 'Applications → hires' },
    { label: 'Approved employers', value: num(data.approvedEmployers) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold text-belize-navy">{k.value}</p>
            {k.hint && <p className="mt-0.5 text-xs text-slate-400">{k.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MiniTable
          title="Active jobs by category"
          rows={data.byCategory.map((c) => ({ label: c.category, count: c.count }))}
        />
        <MiniTable
          title="Active jobs by district"
          rows={data.byDistrict.map((d) => ({ label: districtLabel(d.district) ?? d.district, count: d.count }))}
        />
      </div>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-belize-navy">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-belize-navy" title={r.label}>
                {r.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-belize-blue"
                  style={{ width: max > 0 ? `${Math.max(4, (r.count / max) * 100)}%` : '0%' }}
                  aria-hidden
                />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-semibold text-belize-navy">{num(r.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
