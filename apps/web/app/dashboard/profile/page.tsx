'use client';

import { useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import { api } from '../../../lib/api';
import type { MeView } from '../../../lib/types';
import { FormError, FormSuccess } from '../../../components/auth/AuthShell';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui';

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
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {!error && <Spinner className="h-4 w-4" />}
        {error ?? 'Loading profile…'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profile" />
      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />
          {saved && <FormSuccess message="Profile saved." />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName">
              <Input id="firstName" name="firstName" defaultValue={me.firstName} required />
            </Field>
            <Field label="Last name" htmlFor="lastName">
              <Input id="lastName" name="lastName" defaultValue={me.lastName} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={me.phone ?? ''} placeholder="+501 …" />
            </Field>
            <Field label="District" htmlFor="district">
              <Select id="district" name="district" defaultValue={me.district ?? ''}>
                <option value="">Select…</option>
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {DISTRICT_LABELS[d]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Address" htmlFor="addressLine1">
            <Input id="addressLine1" name="addressLine1" defaultValue={me.addressLine1 ?? ''} />
          </Field>
          <Field label="City / Town" htmlFor="city">
            <Input id="city" name="city" defaultValue={me.city ?? ''} />
          </Field>
          <div className="pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-4 p-4 text-sm text-slate-600">
        <span className="font-medium text-belize-navy">Email:</span> {me.email}{' '}
        {me.emailVerified ? (
          <Badge tone="success" className="ml-1 align-middle">
            Verified
          </Badge>
        ) : (
          <Badge tone="warning" className="ml-1 align-middle">
            Unverified
          </Badge>
        )}
      </Card>
    </div>
  );
}
