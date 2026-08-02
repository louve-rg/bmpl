'use client';

import { useCallback, useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  type AgencyProfile,
  type AgencyProfileInput,
} from '../../../../lib/realestate';
import { AgentGate } from '../../../../components/realestate/AgentGate';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
} from '../../../../components/ui';

export default function AgencyProfilePage() {
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAgency(await realEstateApi.agentDashboard.getAgency());
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
        title="Agency"
        description="Your agency's public profile and branding. Optional — leave blank if you work independently."
      />
      {agency ? (
        <AssetManager agency={agency} onChanged={load} />
      ) : (
        <Alert tone="info">Save your agency details below to enable logo and banner uploads.</Alert>
      )}
      <ProfileForm agency={agency} onSaved={load} />
    </div>
  );
}

function AssetManager({ agency, onChanged }: { agency: AgencyProfile; onChanged: () => void }) {
  const [busy, setBusy] = useState<'logo' | 'banner' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: 'logo' | 'banner', file: File | null) {
    if (!file) return;
    setError(null);
    setBusy(kind);
    try {
      await realEstateApi.agentDashboard.uploadAgencyAsset(kind, file);
      onChanged();
    } catch (e) {
      setError((e as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="bmpl-eyebrow">Branding</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Logo</Label>
          <div className="mt-1 flex items-center gap-3">
            {agency.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agency.logoUrl} alt="Logo" className="h-14 w-14 rounded-bmpl-md object-cover" />
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
            {agency.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agency.bannerUrl} alt="Banner" className="h-14 w-24 rounded-bmpl-md object-cover" />
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

function ProfileForm({ agency, onSaved }: { agency: AgencyProfile | null; onSaved: () => void }) {
  const [v, setV] = useState({
    name: agency?.name ?? '',
    legalName: agency?.legalName ?? '',
    description: agency?.description ?? '',
    contactEmail: agency?.contactEmail ?? '',
    contactPhone: agency?.contactPhone ?? '',
    website: agency?.website ?? '',
    district: agency?.district ?? '',
    addressLine1: agency?.addressLine1 ?? '',
    city: agency?.city ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!v.name.trim() || !v.contactEmail.trim()) {
      setMsg({ kind: 'err', text: 'Agency name and contact email are required.' });
      return;
    }
    setBusy(true);
    const body: AgencyProfileInput = {
      name: v.name.trim(),
      legalName: v.legalName.trim() || null,
      description: v.description.trim() || null,
      contactEmail: v.contactEmail.trim(),
      contactPhone: v.contactPhone.trim() || null,
      website: v.website.trim() || null,
      district: (v.district || null) as District | null,
      addressLine1: v.addressLine1.trim() || null,
      city: v.city.trim() || null,
    };
    try {
      await realEstateApi.agentDashboard.updateAgency(body);
      setMsg({ kind: 'ok', text: 'Agency saved.' });
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
          <Field label="Agency name">
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
          </Field>
          <Field label="Legal name (optional)">
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <textarea className="bmpl-input" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Address line 1 (optional)">
            <Input value={v.addressLine1} onChange={(e) => setV({ ...v, addressLine1: e.target.value })} />
          </Field>
          <Field label="City (optional)">
            <Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
          </Field>
        </div>
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save agency'}</Button>
      </form>
    </Card>
  );
}
