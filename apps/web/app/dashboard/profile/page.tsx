'use client';

import { useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import { api } from '../../../lib/api';
import type { MeView } from '../../../lib/types';
import { FormError, FormSuccess } from '../../../components/auth/AuthShell';
import { Button } from '../../../components/ui';

export default function ProfilePage() {
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<MeView>('/me').then(setMe).catch(() => setError('Unable to load your profile.'));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    try {
      const updated = await api.patch<MeView>('/me/profile', {
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        phone: form.get('phone') || '',
        district: form.get('district') || undefined,
        addressLine1: form.get('addressLine1') || '',
        city: form.get('city') || '',
      });
      setMe(updated);
      setSaved(true);
    } catch (err) {
      const apiErr = err as { errors?: Array<{ message: string }>; message?: string };
      setError(apiErr.errors?.[0]?.message ?? apiErr.message ?? 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }

  if (!me) {
    return <p className="text-sm text-slate-500">{error ?? 'Loading profile…'}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-belize-navy">Profile</h1>
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <FormError message={error} />
        {saved && <FormSuccess message="Profile saved." />}
        <div className="grid gap-4 sm:grid-cols-2">
          <DefaultField label="First name" name="firstName" defaultValue={me.firstName} required />
          <DefaultField label="Last name" name="lastName" defaultValue={me.lastName} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DefaultField label="Phone" name="phone" defaultValue={me.phone ?? ''} placeholder="+501 …" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">District</span>
            <select
              name="district"
              defaultValue={me.district ?? ''}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
            >
              <option value="">Select…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DefaultField label="Address" name="addressLine1" defaultValue={me.addressLine1 ?? ''} />
        <DefaultField label="City / Town" name="city" defaultValue={me.city ?? ''} />
        <div className="pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <span className="font-medium text-belize-navy">Email:</span> {me.email}{' '}
        {me.emailVerified ? (
          <span className="ml-1 text-green-600">✓ verified</span>
        ) : (
          <span className="ml-1 text-amber-600">unverified</span>
        )}
      </div>
    </div>
  );
}

function DefaultField({
  label,
  name,
  defaultValue,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
      />
    </label>
  );
}
