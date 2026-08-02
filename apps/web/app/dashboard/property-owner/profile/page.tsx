'use client';

import { useCallback, useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  type OwnerProfile,
  type OwnerProfileInput,
  type ContactPreference,
} from '../../../../lib/realestate';
import { PropertyOwnerGate } from '../../../../components/realestate/PropertyOwnerGate';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
} from '../../../../components/ui';

const CONTACT_LABELS: Record<ContactPreference, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  MESSAGE: 'Platform message',
};

export default function OwnerProfilePage() {
  const [profile, setProfile] = useState<OwnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile(await realEstateApi.owner.getProfile());
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
  if (forbidden) return <PropertyOwnerGate />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Property owner"
        title="Owner profile"
        description="Your contact details as they appear to enquirers and assigned agents."
        actions={
          <ButtonLink href="/dashboard/property-owner/listings" size="sm" variant="outline">
            My listings
          </ButtonLink>
        }
      />
      {profile && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Approval status:</span>
          <StatusBadge status={profile.approvalStatus} />
        </div>
      )}
      <ProfileForm profile={profile} onSaved={load} />
    </div>
  );
}

function ProfileForm({ profile, onSaved }: { profile: OwnerProfile | null; onSaved: () => void }) {
  const [v, setV] = useState({
    legalName: profile?.legalName ?? '',
    displayName: profile?.displayName ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    district: profile?.district ?? '',
    contactPreference: profile?.contactPreference ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!v.legalName.trim()) {
      setMsg({ kind: 'err', text: 'Legal name is required.' });
      return;
    }
    setBusy(true);
    const body: OwnerProfileInput = {
      legalName: v.legalName.trim(),
      displayName: v.displayName.trim() || null,
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      district: (v.district || null) as District | null,
      contactPreference: (v.contactPreference || null) as ContactPreference | null,
    };
    try {
      await realEstateApi.owner.updateProfile(body);
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
          <Field label="Legal name">
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} required />
          </Field>
          <Field label="Display name (optional)">
            <Input value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
          </Field>
          <Field label="Phone (optional)">
            <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </Field>
          <Field label="Email (optional)">
            <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
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
          <Field label="Preferred contact (optional)">
            <Select value={v.contactPreference} onChange={(e) => setV({ ...v, contactPreference: e.target.value })}>
              <option value="">No preference</option>
              {(Object.keys(CONTACT_LABELS) as ContactPreference[]).map((c) => (
                <option key={c} value={c}>
                  {CONTACT_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </Card>
  );
}
