'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABELS,
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  SALARY_VISIBILITIES,
  JOB_APPLICATION_METHODS,
  type EmploymentType,
  type SalaryVisibility,
  type JobApplicationMethod,
} from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import {
  jobsApi,
  type CreateJobInput,
  type EmployerJobDetail,
  type JobCategory,
  type JobSkill,
} from '../../lib/jobs';
import { Alert, Badge, Button, Card, Field, Input, Label, Select } from '../ui';

const VISIBILITY_LABELS: Record<SalaryVisibility, string> = {
  HIDDEN: 'Hidden',
  RANGE: 'Show range',
  EXACT: 'Show exact figure',
};
const METHOD_LABELS: Record<JobApplicationMethod, string> = {
  INTERNAL: 'Apply on Belize Connect',
  EXTERNAL_URL: 'External website',
  EMAIL: 'Email',
};

const toMinor = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
const toDollars = (m: number | null | undefined) => (m == null ? '' : (m / 100).toString());

interface FormState {
  title: string;
  jobCategoryId: string;
  employmentType: EmploymentType;
  workArrangement: string;
  district: string;
  city: string;
  remoteEligible: boolean;
  description: string;
  responsibilities: string;
  requirements: string;
  preferredQualifications: string;
  experienceLevel: string;
  educationLevel: string;
  salaryMin: string;
  salaryMax: string;
  salaryPeriod: string;
  salaryVisibility: SalaryVisibility;
  openings: string;
  applicationDeadline: string;
  startDate: string;
  applicationMethod: JobApplicationMethod;
  externalUrl: string;
  applicationEmail: string;
}

function fromDetail(d?: EmployerJobDetail): FormState {
  return {
    title: d?.title ?? '',
    jobCategoryId: d?.jobCategoryId ?? '',
    employmentType: d?.employmentType ?? 'FULL_TIME',
    workArrangement: d?.workArrangement ?? '',
    district: d?.district ?? '',
    city: d?.city ?? '',
    remoteEligible: d?.remoteEligible ?? false,
    description: d?.description ?? '',
    responsibilities: d?.responsibilities ?? '',
    requirements: d?.requirements ?? '',
    preferredQualifications: d?.preferredQualifications ?? '',
    experienceLevel: d?.experienceLevel ?? '',
    educationLevel: d?.educationLevel ?? '',
    salaryMin: toDollars(d?.salaryMinMinor),
    salaryMax: toDollars(d?.salaryMaxMinor),
    salaryPeriod: d?.salaryPeriod ?? '',
    salaryVisibility: d?.salaryVisibility ?? 'HIDDEN',
    openings: d?.openings != null ? String(d.openings) : '',
    applicationDeadline: d?.applicationDeadline ? d.applicationDeadline.slice(0, 10) : '',
    startDate: d?.startDate ? d.startDate.slice(0, 10) : '',
    applicationMethod: d?.applicationMethod ?? 'INTERNAL',
    externalUrl: d?.externalUrl ?? '',
    applicationEmail: d?.applicationEmail ?? '',
  };
}

/** Create / edit form for a job listing (all createJob fields + skills + benefits). */
export function EmployerJobForm({ initial }: { initial?: EmployerJobDetail }) {
  const router = useRouter();
  const isEdit = !!initial?.id;
  const [v, setV] = useState<FormState>(fromDetail(initial));
  const [skills, setSkills] = useState<JobSkill[]>(initial?.skills ?? []);
  const [benefits, setBenefits] = useState<string[]>(initial?.benefits ?? []);
  const [cats, setCats] = useState<JobCategory[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillRequired, setSkillRequired] = useState(false);
  const [benefit, setBenefit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    jobsApi.categories().then(setCats).catch(() => {});
  }, []);

  function set<K extends keyof FormState>(k: K, val: FormState[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  function buildBody(): CreateJobInput {
    return {
      title: v.title.trim(),
      jobCategoryId: v.jobCategoryId || null,
      employmentType: v.employmentType,
      workArrangement: (v.workArrangement || null) as CreateJobInput['workArrangement'],
      district: (v.district || null) as CreateJobInput['district'],
      city: v.city.trim() || null,
      remoteEligible: v.remoteEligible,
      description: v.description.trim(),
      responsibilities: v.responsibilities.trim() || null,
      requirements: v.requirements.trim() || null,
      preferredQualifications: v.preferredQualifications.trim() || null,
      experienceLevel: (v.experienceLevel || null) as CreateJobInput['experienceLevel'],
      educationLevel: (v.educationLevel || null) as CreateJobInput['educationLevel'],
      salaryMinMinor: toMinor(v.salaryMin),
      salaryMaxMinor: toMinor(v.salaryMax),
      salaryPeriod: (v.salaryPeriod || null) as CreateJobInput['salaryPeriod'],
      salaryVisibility: v.salaryVisibility,
      openings: v.openings ? Number(v.openings) : null,
      applicationDeadline: v.applicationDeadline || null,
      startDate: v.startDate || null,
      applicationMethod: v.applicationMethod,
      externalUrl: v.externalUrl.trim() || null,
      applicationEmail: v.applicationEmail.trim() || null,
      skills,
      benefits,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!v.title.trim() || !v.description.trim()) {
      setError('Title and description are required.');
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await jobsApi.employer.updateJob(initial!.id, buildBody());
        router.push('/dashboard/employer/jobs');
        router.refresh();
      } else {
        const created = await jobsApi.employer.createJob(buildBody());
        router.push(`/dashboard/employer/jobs/${created.id}`);
      }
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Overview</h2>
        <Field label="Job title">
          <Input value={v.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={v.jobCategoryId} onChange={(e) => set('jobCategoryId', e.target.value)}>
              <option value="">Uncategorized</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment type">
            <Select value={v.employmentType} onChange={(e) => set('employmentType', e.target.value as EmploymentType)}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work arrangement">
            <Select value={v.workArrangement} onChange={(e) => set('workArrangement', e.target.value)}>
              <option value="">Not specified</option>
              {WORK_ARRANGEMENTS.map((w) => (
                <option key={w} value={w}>
                  {WORK_ARRANGEMENT_LABELS[w]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="District">
            <Select value={v.district} onChange={(e) => set('district', e.target.value)}>
              <option value="">Not specified</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City / town">
            <Input value={v.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Openings">
            <Input inputMode="numeric" value={v.openings} onChange={(e) => set('openings', e.target.value)} placeholder="1" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={v.remoteEligible}
            onChange={(e) => set('remoteEligible', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
          />
          Remote eligible
        </label>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Description</h2>
        <Field label="About the role">
          <textarea className="bmpl-input" rows={5} value={v.description} onChange={(e) => set('description', e.target.value)} required />
        </Field>
        <Field label="Responsibilities (optional)">
          <textarea className="bmpl-input" rows={3} value={v.responsibilities} onChange={(e) => set('responsibilities', e.target.value)} />
        </Field>
        <Field label="Requirements (optional)">
          <textarea className="bmpl-input" rows={3} value={v.requirements} onChange={(e) => set('requirements', e.target.value)} />
        </Field>
        <Field label="Preferred qualifications (optional)">
          <textarea className="bmpl-input" rows={3} value={v.preferredQualifications} onChange={(e) => set('preferredQualifications', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Experience level">
            <Select value={v.experienceLevel} onChange={(e) => set('experienceLevel', e.target.value)}>
              <option value="">Not specified</option>
              {EXPERIENCE_LEVELS.map((x) => (
                <option key={x} value={x}>
                  {EXPERIENCE_LEVEL_LABELS[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Education level">
            <Select value={v.educationLevel} onChange={(e) => set('educationLevel', e.target.value)}>
              <option value="">Not specified</option>
              {EDUCATION_LEVELS.map((x) => (
                <option key={x} value={x}>
                  {EDUCATION_LEVEL_LABELS[x]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Compensation</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Salary min ($)">
            <Input inputMode="decimal" value={v.salaryMin} onChange={(e) => set('salaryMin', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Salary max ($)">
            <Input inputMode="decimal" value={v.salaryMax} onChange={(e) => set('salaryMax', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Period">
            <Select value={v.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value)}>
              <option value="">—</option>
              {SALARY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {SALARY_PERIOD_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Visibility">
            <Select value={v.salaryVisibility} onChange={(e) => set('salaryVisibility', e.target.value as SalaryVisibility)}>
              {SALARY_VISIBILITIES.map((s) => (
                <option key={s} value={s}>
                  {VISIBILITY_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Skills</h2>
        <div className="flex flex-wrap gap-2">
          {skills.length === 0 && <p className="text-sm text-slate-400">No skills added.</p>}
          {skills.map((s, i) => (
            <span key={`${s.name}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
              {s.name}
              {s.required && <Badge tone="brand">required</Badge>}
              <button type="button" onClick={() => setSkills(skills.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="Add a skill" className="max-w-xs" />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={skillRequired} onChange={(e) => setSkillRequired(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent" />
            Required
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (skillName.trim()) {
                setSkills([...skills, { name: skillName.trim(), required: skillRequired }]);
                setSkillName('');
                setSkillRequired(false);
              }
            }}
          >
            Add skill
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Benefits</h2>
        <div className="flex flex-wrap gap-2">
          {benefits.length === 0 && <p className="text-sm text-slate-400">No benefits added.</p>}
          {benefits.map((b, i) => (
            <span key={`${b}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
              {b}
              <button type="button" onClick={() => setBenefits(benefits.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={benefit} onChange={(e) => setBenefit(e.target.value)} placeholder="Add a benefit" className="max-w-xs" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (benefit.trim()) {
                setBenefits([...benefits, benefit.trim()]);
                setBenefit('');
              }
            }}
          >
            Add benefit
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Application & dates</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Application deadline">
            <Input type="date" value={v.applicationDeadline} onChange={(e) => set('applicationDeadline', e.target.value)} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="How to apply">
            <Select value={v.applicationMethod} onChange={(e) => set('applicationMethod', e.target.value as JobApplicationMethod)}>
              {JOB_APPLICATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          {v.applicationMethod === 'EXTERNAL_URL' && (
            <Field label="External application URL">
              <Input value={v.externalUrl} onChange={(e) => set('externalUrl', e.target.value)} placeholder="https://" />
            </Field>
          )}
          {v.applicationMethod === 'EMAIL' && (
            <Field label="Application email">
              <Input type="email" value={v.applicationEmail} onChange={(e) => set('applicationEmail', e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      <div>
        <Button disabled={busy} size="lg">
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft'}
        </Button>
        {!isEdit && <p className="mt-1.5 text-xs text-slate-400">You'll add screening questions and submit for review next.</p>}
      </div>
    </form>
  );
}
