'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  AGENT_SPECIALTIES,
  AGENT_SPECIALTY_LABELS,
  type District,
  type AgentSpecialty,
} from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  type AgentProfile,
  type AgentProfileInput,
} from '../../../../lib/realestate';
import { AgentGate } from '../../../../components/realestate/AgentGate';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Label,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../../../../components/ui';

export default function AgentProfilePage() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile(await realEstateApi.agentDashboard.getProfile());
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
  if (forbidden) return <AgentGate />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Real-estate agent"
        title="Agent profile"
        description="Your public agent page and contact details."
        actions={
          <ButtonLink href="/dashboard/real-estate-agent/agency" size="sm" variant="outline">
            Agency
          </ButtonLink>
        }
      />
      {profile && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-500">Approval status:</span>
          <StatusBadge status={profile.approvalStatus} />
          <ButtonLink href={`/properties/agents/${profile.slug}`} size="sm" variant="ghost">
            View public page
          </ButtonLink>
        </div>
      )}
      {profile && <PhotoManager profile={profile} onChanged={load} />}
      <ProfileForm profile={profile} onSaved={load} />
    </div>
  );
}

function PhotoManager({ profile, onChanged }: { profile: AgentProfile; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | null) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await realEstateApi.agentDashboard.uploadPhoto(file);
      onChanged();
    } catch (e) {
      setError((e as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="bmpl-eyebrow">Profile photo</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-center gap-3">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photoUrl} alt="Photo" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">None</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => upload(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
        />
      </div>
    </Card>
  );
}

function ProfileForm({ profile, onSaved }: { profile: AgentProfile | null; onSaved: () => void }) {
  const [v, setV] = useState({
    displayName: profile?.displayName ?? '',
    legalName: profile?.legalName ?? '',
    bio: profile?.bio ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    website: profile?.website ?? '',
    yearsExperience: profile?.yearsExperience != null ? String(profile.yearsExperience) : '',
  });
  const [serviceDistricts, setServiceDistricts] = useState<District[]>(profile?.serviceDistricts ?? []);
  const [specialties, setSpecialties] = useState<AgentSpecialty[]>(profile?.specialties ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function toggleDistrict(d: District) {
    setServiceDistricts((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function toggleSpecialty(s: AgentSpecialty) {
    setSpecialties((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!v.displayName.trim()) {
      setMsg({ kind: 'err', text: 'Display name is required.' });
      return;
    }
    setBusy(true);
    const body: AgentProfileInput = {
      displayName: v.displayName.trim(),
      legalName: v.legalName.trim() || null,
      bio: v.bio.trim() || null,
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      website: v.website.trim() || null,
      serviceDistricts,
      specialties,
      yearsExperience: v.yearsExperience.trim() === '' ? null : Number(v.yearsExperience),
    };
    try {
      await realEstateApi.agentDashboard.updateProfile(body);
      setMsg({ kind: 'ok', text: 'Profile saved.' });
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} required />
          </Field>
          <Field label="Legal name (optional)">
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </Field>
        </div>
        <Field label="Bio (optional)">
          <textarea className="bmpl-input" rows={4} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone (optional)">
            <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </Field>
          <Field label="Email (optional)">
            <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </Field>
          <Field label="Website (optional)">
            <Input value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Years of experience (optional)">
            <Input inputMode="numeric" value={v.yearsExperience} onChange={(e) => setV({ ...v, yearsExperience: e.target.value })} />
          </Field>
        </div>

        <div>
          <Label>Service districts</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {DISTRICTS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={serviceDistricts.includes(d)}
                  onChange={() => toggleDistrict(d)}
                  className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
                />
                {DISTRICT_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>Specialties</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {AGENT_SPECIALTIES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={specialties.includes(s)}
                  onChange={() => toggleSpecialty(s)}
                  className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
                />
                {AGENT_SPECIALTY_LABELS[s]}
              </label>
            ))}
          </div>
        </div>

        <Button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </Card>
  );
}
