'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  SEEKER_EMPLOYMENT_STATUSES,
  JOB_SEEKER_VISIBILITIES,
  MAX_RESUMES_PER_SEEKER,
  RESUME_MIME_TYPES,
  isAllowedResumeMime,
  MAX_RESUME_BYTES,
  type District,
  type EmploymentType,
  type SeekerEmploymentStatus,
  type JobSeekerVisibility,
} from '@bmpl/shared';
import { api, type ApiError } from '../../../../lib/api';
import {
  jobsApi,
  type SeekerProfile,
  type SeekerProfileInput,
  type SeekerChildKind,
  type SeekerResume,
} from '../../../../lib/jobs';
import { formatBytes } from '../../../../lib/messaging';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
} from '../../../../components/ui';

const EMPLOYMENT_STATUS_LABELS: Record<SeekerEmploymentStatus, string> = {
  OPEN_TO_WORK: 'Open to work',
  EMPLOYED: 'Employed',
  UNEMPLOYED: 'Unemployed',
  STUDENT: 'Student',
  NOT_LOOKING: 'Not actively looking',
};
const VISIBILITY_LABELS: Record<JobSeekerVisibility, string> = {
  PRIVATE: 'Private — visible only to you',
  EMPLOYERS_ONLY: 'Employers only — shown to employers you apply to',
  PUBLIC_SUMMARY: 'Public summary — a summary is discoverable',
};

const toMinor = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
const toDollars = (m: number | null) => (m == null ? '' : (m / 100).toString());

export default function JobSeekerProfilePage() {
  const [profile, setProfile] = useState<SeekerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile(await jobsApi.getProfile());
      setError(null);
    } catch (e) {
      setError((e as ApiError).message ?? 'Failed to load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Belize Connect"
        title="Job profile"
        description="Your profile powers applications. Control what employers can see with the visibility setting."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : profile ? (
        <>
          <ScalarForm profile={profile} onSaved={load} />
          <ResumeManager profile={profile} onChanged={load} />
          <SkillsCollection profile={profile} onChanged={load} />
          <ExperienceCollection profile={profile} onChanged={load} />
          <EducationCollection profile={profile} onChanged={load} />
          <CertificationsCollection profile={profile} onChanged={load} />
          <LanguagesCollection profile={profile} onChanged={load} />
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- scalar form */

function ScalarForm({ profile, onSaved }: { profile: SeekerProfile; onSaved: () => void }) {
  const [v, setV] = useState({
    preferredName: profile.preferredName ?? '',
    legalName: profile.legalName ?? '',
    headline: profile.headline ?? '',
    summary: profile.summary ?? '',
    district: profile.district ?? '',
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    employmentStatus: profile.employmentStatus,
    preferredTypes: profile.preferredTypes ?? [],
    preferredDistricts: profile.preferredDistricts ?? [],
    remotePreference: profile.remotePreference ?? '',
    availabilityDate: profile.availabilityDate ? profile.availabilityDate.slice(0, 10) : '',
    salaryExpect: toDollars(profile.salaryExpectMinor),
    salaryPeriod: profile.salaryPeriod ?? '',
    salaryExpectPublic: profile.salaryExpectPublic,
    visibility: profile.visibility,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!v.preferredName.trim()) {
      setMsg({ kind: 'err', text: 'Preferred name is required.' });
      return;
    }
    setBusy(true);
    const body: SeekerProfileInput = {
      preferredName: v.preferredName.trim(),
      legalName: v.legalName.trim() || null,
      headline: v.headline.trim() || null,
      summary: v.summary.trim() || null,
      district: (v.district || null) as District | null,
      contactEmail: v.contactEmail.trim() || null,
      contactPhone: v.contactPhone.trim() || null,
      employmentStatus: v.employmentStatus,
      preferredTypes: v.preferredTypes,
      preferredDistricts: v.preferredDistricts,
      remotePreference: (v.remotePreference || null) as SeekerProfileInput['remotePreference'],
      availabilityDate: v.availabilityDate || null,
      salaryExpectMinor: toMinor(v.salaryExpect),
      salaryPeriod: (v.salaryPeriod || null) as SeekerProfileInput['salaryPeriod'],
      salaryExpectPublic: v.salaryExpectPublic,
      visibility: v.visibility,
    };
    try {
      await jobsApi.updateProfile(body);
      setMsg({ kind: 'ok', text: 'Profile saved.' });
      onSaved();
    } catch (e2) {
      setMsg({ kind: 'err', text: (e2 as ApiError).message ?? 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <form onSubmit={save} className="space-y-4">
        {msg && <Alert tone={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</Alert>}
        <h2 className="bmpl-eyebrow">Basics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred name">
            <Input value={v.preferredName} onChange={(e) => setV({ ...v, preferredName: e.target.value })} required />
          </Field>
          <Field label="Legal name (optional)">
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </Field>
        </div>
        <Field label="Headline (optional)">
          <Input
            value={v.headline}
            onChange={(e) => setV({ ...v, headline: e.target.value })}
            placeholder="e.g. Experienced hospitality manager"
          />
        </Field>
        <Field label="Summary (optional)">
          <textarea
            className="bmpl-input"
            rows={4}
            value={v.summary}
            onChange={(e) => setV({ ...v, summary: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="District">
            <Select value={v.district} onChange={(e) => setV({ ...v, district: e.target.value })}>
              <option value="">Select…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment status">
            <Select
              value={v.employmentStatus}
              onChange={(e) => setV({ ...v, employmentStatus: e.target.value as SeekerEmploymentStatus })}
            >
              {SEEKER_EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contact email (optional)">
            <Input type="email" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact phone (optional)">
            <Input value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} />
          </Field>
        </div>

        <div>
          <Label>Preferred employment types</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {EMPLOYMENT_TYPES.map((t) => (
              <CheckChip
                key={t}
                label={EMPLOYMENT_TYPE_LABELS[t]}
                checked={v.preferredTypes.includes(t)}
                onChange={() => setV({ ...v, preferredTypes: toggle(v.preferredTypes as EmploymentType[], t) })}
              />
            ))}
          </div>
        </div>
        <div>
          <Label>Preferred districts</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {DISTRICTS.map((d) => (
              <CheckChip
                key={d}
                label={DISTRICT_LABELS[d]}
                checked={v.preferredDistricts.includes(d)}
                onChange={() => setV({ ...v, preferredDistricts: toggle(v.preferredDistricts as District[], d) })}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Remote preference">
            <Select value={v.remotePreference} onChange={(e) => setV({ ...v, remotePreference: e.target.value })}>
              <option value="">No preference</option>
              {WORK_ARRANGEMENTS.map((w) => (
                <option key={w} value={w}>
                  {WORK_ARRANGEMENT_LABELS[w]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Available from">
            <Input type="date" value={v.availabilityDate} onChange={(e) => setV({ ...v, availabilityDate: e.target.value })} />
          </Field>
          <Field label="Salary expectation ($)">
            <Input inputMode="decimal" value={v.salaryExpect} onChange={(e) => setV({ ...v, salaryExpect: e.target.value })} placeholder="0.00" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salary period">
            <Select value={v.salaryPeriod} onChange={(e) => setV({ ...v, salaryPeriod: e.target.value })}>
              <option value="">—</option>
              {SALARY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {SALARY_PERIOD_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={v.salaryExpectPublic}
              onChange={(e) => setV({ ...v, salaryExpectPublic: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
            />
            Show my salary expectation to employers
          </label>
        </div>

        <Field label="Profile visibility">
          <Select value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as JobSeekerVisibility })}>
            {JOB_SEEKER_VISIBILITIES.map((vis) => (
              <option key={vis} value={vis}>
                {VISIBILITY_LABELS[vis]}
              </option>
            ))}
          </Select>
        </Field>

        <Button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </Card>
  );
}

function CheckChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label
      className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition ${
        checked ? 'border-belize-blue bg-belize-blue/10 text-belize-blue' : 'border-slate-300 text-slate-600 hover:border-belize-light/60'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

/* --------------------------------------------------------------- collection shell */

function CollectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="space-y-3 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-bold text-belize-navy">{title}</h2>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function RemoveButton({ kind, id, onChanged }: { kind: SeekerChildKind; id: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await jobsApi.removeChild(kind, id);
          onChanged();
        } finally {
          setBusy(false);
        }
      }}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      Remove
    </button>
  );
}

function AddError({ error }: { error: string | null }) {
  return error ? <p className="text-xs font-medium text-red-600">{error}</p> : null;
}

async function addChild(
  kind: SeekerChildKind,
  body: unknown,
  onChanged: () => void,
  setError: (s: string | null) => void,
  reset: () => void,
) {
  setError(null);
  try {
    await jobsApi.addChild(kind, body);
    reset();
    onChanged();
  } catch (e) {
    setError((e as ApiError).message ?? 'Could not add.');
  }
}

/* ---- skills ---- */
function SkillsCollection({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <CollectionCard title="Skills">
      <div className="flex flex-wrap gap-2">
        {profile.skills.length === 0 && <p className="text-sm text-slate-400">No skills added yet.</p>}
        {profile.skills.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            {s.name}
            <RemoveButton kind="skills" id={s.id} onChanged={onChanged} />
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void addChild('skills', { name: name.trim() }, onChanged, setError, () => setName(''));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a skill" className="max-w-xs" />
        <Button type="submit" size="sm" variant="outline">
          Add
        </Button>
      </form>
      <AddError error={error} />
    </CollectionCard>
  );
}

/* ---- experience ---- */
function ExperienceCollection({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const empty = { title: '', company: '', district: '', startDate: '', endDate: '', current: false, description: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  return (
    <CollectionCard title="Work experience">
      <div className="space-y-2">
        {profile.experience.map((x) => (
          <div key={x.id} className="flex items-start justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold text-belize-navy">
                {x.title} · {x.company}
              </p>
              <p className="text-xs text-slate-500">
                {[x.startDate?.slice(0, 10), x.current ? 'Present' : x.endDate?.slice(0, 10)].filter(Boolean).join(' – ')}
                {x.district ? ` · ${DISTRICT_LABELS[x.district]}` : ''}
              </p>
              {x.description && <p className="mt-1 text-xs text-slate-600">{x.description}</p>}
            </div>
            <RemoveButton kind="experience" id={x.id} onChanged={onChanged} />
          </div>
        ))}
      </div>
      <form
        className="space-y-2 border-t border-slate-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.title.trim() || !f.company.trim()) {
            setError('Title and company are required.');
            return;
          }
          void addChild(
            'experience',
            {
              title: f.title.trim(),
              company: f.company.trim(),
              district: f.district || undefined,
              startDate: f.startDate || undefined,
              endDate: f.current ? undefined : f.endDate || undefined,
              current: f.current,
              description: f.description.trim() || undefined,
            },
            onChanged,
            setError,
            () => setF(empty),
          );
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Job title" />
          <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Company" />
          <Select value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
            <option value="">District (optional)</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
          <div />
          <label className="text-xs text-slate-500">
            Start
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </label>
          <label className="text-xs text-slate-500">
            End
            <Input type="date" value={f.endDate} disabled={f.current} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </label>
        </div>
        <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description (optional)" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={f.current} onChange={(e) => setF({ ...f, current: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent" />
          I currently work here
        </label>
        <AddError error={error} />
        <Button type="submit" size="sm" variant="outline">
          Add experience
        </Button>
      </form>
    </CollectionCard>
  );
}

/* ---- education ---- */
function EducationCollection({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const empty = { institution: '', level: '', fieldOfStudy: '', startYear: '', endYear: '', current: false };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  return (
    <CollectionCard title="Education">
      <div className="space-y-2">
        {profile.education.map((x) => (
          <div key={x.id} className="flex items-start justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold text-belize-navy">{x.institution}</p>
              <p className="text-xs text-slate-500">
                {[x.level ? EDUCATION_LEVEL_LABELS[x.level] : null, x.fieldOfStudy, [x.startYear, x.current ? 'Present' : x.endYear].filter(Boolean).join('–')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <RemoveButton kind="education" id={x.id} onChanged={onChanged} />
          </div>
        ))}
      </div>
      <form
        className="space-y-2 border-t border-slate-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.institution.trim()) {
            setError('Institution is required.');
            return;
          }
          void addChild(
            'education',
            {
              institution: f.institution.trim(),
              level: f.level || undefined,
              fieldOfStudy: f.fieldOfStudy.trim() || undefined,
              startYear: f.startYear ? Number(f.startYear) : undefined,
              endYear: f.current ? undefined : f.endYear ? Number(f.endYear) : undefined,
              current: f.current,
            },
            onChanged,
            setError,
            () => setF(empty),
          );
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} placeholder="Institution" />
          <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
            <option value="">Level (optional)</option>
            {EDUCATION_LEVELS.map((l) => (
              <option key={l} value={l}>
                {EDUCATION_LEVEL_LABELS[l]}
              </option>
            ))}
          </Select>
          <Input value={f.fieldOfStudy} onChange={(e) => setF({ ...f, fieldOfStudy: e.target.value })} placeholder="Field of study" />
          <div />
          <Input inputMode="numeric" value={f.startYear} onChange={(e) => setF({ ...f, startYear: e.target.value })} placeholder="Start year" />
          <Input inputMode="numeric" value={f.endYear} disabled={f.current} onChange={(e) => setF({ ...f, endYear: e.target.value })} placeholder="End year" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={f.current} onChange={(e) => setF({ ...f, current: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent" />
          Currently studying
        </label>
        <AddError error={error} />
        <Button type="submit" size="sm" variant="outline">
          Add education
        </Button>
      </form>
    </CollectionCard>
  );
}

/* ---- certifications ---- */
function CertificationsCollection({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const empty = { name: '', issuer: '', issuedYear: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  return (
    <CollectionCard title="Certifications">
      <div className="space-y-2">
        {profile.certifications.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-belize-navy">{x.name}</span>
              {[x.issuer, x.issuedYear].filter(Boolean).length > 0 && (
                <span className="text-xs text-slate-500"> · {[x.issuer, x.issuedYear].filter(Boolean).join(', ')}</span>
              )}
            </p>
            <RemoveButton kind="certifications" id={x.id} onChanged={onChanged} />
          </div>
        ))}
      </div>
      <form
        className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name.trim()) {
            setError('Name is required.');
            return;
          }
          void addChild(
            'certifications',
            { name: f.name.trim(), issuer: f.issuer.trim() || undefined, issuedYear: f.issuedYear ? Number(f.issuedYear) : undefined },
            onChanged,
            setError,
            () => setF(empty),
          );
        }}
      >
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Certification" />
        <Input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="Issuer (optional)" />
        <div className="flex gap-2">
          <Input inputMode="numeric" value={f.issuedYear} onChange={(e) => setF({ ...f, issuedYear: e.target.value })} placeholder="Year" />
          <Button type="submit" size="sm" variant="outline">
            Add
          </Button>
        </div>
        <div className="sm:col-span-3">
          <AddError error={error} />
        </div>
      </form>
    </CollectionCard>
  );
}

/* ---- languages ---- */
function LanguagesCollection({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const empty = { name: '', proficiency: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  return (
    <CollectionCard title="Languages">
      <div className="flex flex-wrap gap-2">
        {profile.languages.length === 0 && <p className="text-sm text-slate-400">No languages added yet.</p>}
        {profile.languages.map((x) => (
          <span key={x.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            {x.name}
            {x.proficiency ? ` (${x.proficiency})` : ''}
            <RemoveButton kind="languages" id={x.id} onChanged={onChanged} />
          </span>
        ))}
      </div>
      <form
        className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name.trim()) {
            setError('Language is required.');
            return;
          }
          void addChild(
            'languages',
            { name: f.name.trim(), proficiency: f.proficiency.trim() || undefined },
            onChanged,
            setError,
            () => setF(empty),
          );
        }}
      >
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Language" className="max-w-[12rem]" />
        <Input value={f.proficiency} onChange={(e) => setF({ ...f, proficiency: e.target.value })} placeholder="Proficiency (optional)" className="max-w-[12rem]" />
        <Button type="submit" size="sm" variant="outline">
          Add
        </Button>
      </form>
      <AddError error={error} />
    </CollectionCard>
  );
}

/* --------------------------------------------------------------- résumés */

function ResumeManager({ profile, onChanged }: { profile: SeekerProfile; onChanged: () => void }) {
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atLimit = profile.resumes.length >= MAX_RESUMES_PER_SEEKER;

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a PDF or DOCX file.');
      return;
    }
    if (!isAllowedResumeMime(file.type)) {
      setError('Only PDF and DOCX résumés are allowed.');
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setError(`File too large (max ${formatBytes(MAX_RESUME_BYTES)}).`);
      return;
    }
    setBusy(true);
    try {
      await jobsApi.createResume(file, label);
      setLabel('');
      setFile(null);
      onChanged();
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openResume(r: SeekerResume) {
    try {
      const { url } = await jobsApi.resumeUrl(r.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      setError('Could not open the résumé.');
    }
  }

  return (
    <CollectionCard title="Résumés" description={`PDF or DOCX, up to ${MAX_RESUMES_PER_SEEKER}. Your primary résumé is offered by default when applying.`}>
      <div className="space-y-2">
        {profile.resumes.length === 0 && <p className="text-sm text-slate-400">No résumés uploaded yet.</p>}
        {profile.resumes.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold text-belize-navy">
                {r.label} {r.isPrimary && <Badge tone="success" className="ml-1">Primary</Badge>}
              </p>
              <p className="text-xs text-slate-500">{formatBytes(r.fileSizeBytes)}</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium">
              <button type="button" onClick={() => openResume(r)} className="text-belize-blue hover:underline">
                Open
              </button>
              {!r.isPrimary && (
                <button
                  type="button"
                  onClick={async () => {
                    await jobsApi.setPrimaryResume(r.id);
                    onChanged();
                  }}
                  className="text-slate-500 hover:underline"
                >
                  Set primary
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await jobsApi.deleteResume(r.id);
                  onChanged();
                }}
                className="text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {atLimit ? (
        <p className="text-xs text-slate-500">You have reached the maximum number of résumés. Delete one to upload another.</p>
      ) : (
        <form onSubmit={upload} className="space-y-2 border-t border-slate-100 pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. General résumé)" />
            <input
              type="file"
              accept={RESUME_MIME_TYPES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-2 file:text-belize-blue"
            />
          </div>
          <AddError error={error} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload résumé'}
          </Button>
        </form>
      )}
    </CollectionCard>
  );
}
