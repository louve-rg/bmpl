'use client';

import { useCallback, useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import {
  jobsApi,
  type EmployerProfile,
  type EmployerProfileInput,
  type EmployerAnalytics,
} from '../../../lib/jobs';
import { EmployerGate } from '../../../components/jobs/EmployerGate';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
} from '../../../components/ui';

export default function EmployerHomePage() {
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [analytics, setAnalytics] = useState<EmployerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        jobsApi.employer.getProfile(),
        jobsApi.employer.analytics().catch(() => null),
      ]);
      setProfile(p);
      setAnalytics(a);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (forbidden) return <EmployerGate />;
  if (error || !profile) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Employer"
        title="Company & hiring"
        description="Your public company page, hiring tools, and pipeline analytics."
        actions={
          <>
            <ButtonLink href="/dashboard/employer/jobs" size="sm" variant="outline">
              Manage jobs
            </ButtonLink>
            <ButtonLink href="/dashboard/employer/applications" size="sm">
              Applicants
            </ButtonLink>
          </>
        }
      />

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Approval status:</span>
        <StatusBadge status={profile.approvalStatus} />
      </div>

      {analytics && <AnalyticsCard a={analytics} />}
      <ImageManager profile={profile} onChanged={load} />
      <ProfileForm profile={profile} onSaved={load} />
    </div>
  );
}

function AnalyticsCard({ a }: { a: EmployerAnalytics }) {
  const stats: Array<{ label: string; value: number | string }> = [
    { label: 'Active jobs', value: a.activeJobs },
    { label: 'Total jobs', value: a.totalJobs },
    { label: 'Applications', value: a.applications },
    { label: 'Shortlisted', value: a.shortlisted },
    { label: 'Interviewed', value: a.interviewed },
    { label: 'Hired', value: a.hired },
    { label: 'Conversion', value: `${Math.round((a.applicationConversion ?? 0) * 100)}%` },
  ];
  return (
    <Card className="p-5">
      <h2 className="bmpl-eyebrow mb-3">Hiring analytics</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-bold text-belize-navy">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ImageManager({ profile, onChanged }: { profile: EmployerProfile; onChanged: () => void }) {
  const [busy, setBusy] = useState<'logo' | 'banner' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: 'logo' | 'banner', file: File | null) {
    if (!file) return;
    setError(null);
    setBusy(kind);
    try {
      await jobsApi.employer.uploadImage(kind, file);
      onChanged();
    } catch (e) {
      setError((e as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="bmpl-eyebrow">Brand images</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Logo</Label>
          <div className="mt-1 flex items-center gap-3">
            {profile.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.logoUrl} alt="Logo" className="h-14 w-14 rounded-bmpl-md object-cover" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-bmpl-md bg-slate-100 text-xs text-slate-400">None</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy === 'logo'}
              onChange={(e) => upload('logo', e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
            />
          </div>
        </div>
        <div>
          <Label>Banner</Label>
          <div className="mt-1 flex items-center gap-3">
            {profile.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.bannerUrl} alt="Banner" className="h-14 w-24 rounded-bmpl-md object-cover" />
            ) : (
              <span className="flex h-14 w-24 items-center justify-center rounded-bmpl-md bg-slate-100 text-xs text-slate-400">None</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy === 'banner'}
              onChange={(e) => upload('banner', e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProfileForm({ profile, onSaved }: { profile: EmployerProfile; onSaved: () => void }) {
  const [v, setV] = useState({
    companyName: profile.companyName ?? '',
    legalName: profile.legalName ?? '',
    description: profile.description ?? '',
    industry: profile.industry ?? '',
    companySize: profile.companySize ?? '',
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    website: profile.website ?? '',
    district: profile.district ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!v.companyName.trim() || !v.contactEmail.trim()) {
      setMsg({ kind: 'err', text: 'Company name and contact email are required.' });
      return;
    }
    setBusy(true);
    const body: EmployerProfileInput = {
      companyName: v.companyName.trim(),
      legalName: v.legalName.trim() || null,
      description: v.description.trim() || null,
      industry: v.industry.trim() || null,
      companySize: v.companySize.trim() || null,
      contactEmail: v.contactEmail.trim(),
      contactPhone: v.contactPhone.trim() || null,
      website: v.website.trim() || null,
      district: (v.district || null) as District | null,
      addressLine1: v.addressLine1.trim() || null,
      addressLine2: v.addressLine2.trim() || null,
      city: v.city.trim() || null,
    };
    try {
      await jobsApi.employer.updateProfile(body);
      setMsg({ kind: 'ok', text: 'Company profile saved.' });
      onSaved();
    } catch (e2) {
      setMsg({ kind: 'err', text: (e2 as ApiError).message ?? 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={save} className="space-y-4">
        {msg && <Alert tone={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</Alert>}
        <h2 className="bmpl-eyebrow">Company profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input value={v.companyName} onChange={(e) => setV({ ...v, companyName: e.target.value })} required />
          </Field>
          <Field label="Legal name (optional)">
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <textarea className="bmpl-input" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Industry (optional)">
            <Input value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} />
          </Field>
          <Field label="Company size (optional)">
            <Input value={v.companySize} onChange={(e) => setV({ ...v, companySize: e.target.value })} placeholder="e.g. 11–50" />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} required />
          </Field>
          <Field label="Contact phone (optional)">
            <Input value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} />
          </Field>
          <Field label="Website (optional)">
            <Input value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="District (optional)">
            <Select value={v.district} onChange={(e) => setV({ ...v, district: e.target.value })}>
              <option value="">Select…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City (optional)">
            <Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
          </Field>
          <Field label="Address line 1 (optional)">
            <Input value={v.addressLine1} onChange={(e) => setV({ ...v, addressLine1: e.target.value })} />
          </Field>
          <Field label="Address line 2 (optional)">
            <Input value={v.addressLine2} onChange={(e) => setV({ ...v, addressLine2: e.target.value })} />
          </Field>
        </div>
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save company profile'}</Button>
      </form>
    </Card>
  );
}
