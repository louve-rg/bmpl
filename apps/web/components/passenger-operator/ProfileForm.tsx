'use client';

import { useState, type FormEvent } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '../ui';
import { Card, errMessage, expiryTone, toDateInputValue } from '../driver/dashboard-data';
import type { OperatorProfile } from '../../lib/passenger-operator';

/**
 * The operator's business profile — the application data an applicant builds
 * before the PASSENGER_PROVIDER role is approved, and edits after. No logo or
 * photo upload: the passenger API deliberately accepts no storage keys yet.
 */
export function OperatorProfileForm({ profile, onDone }: { profile: OperatorProfile | null; onDone: () => Promise<void> }) {
  const [f, setF] = useState({
    businessName: profile?.businessName ?? '',
    description: profile?.description ?? '',
    contactEmail: profile?.contactEmail ?? '',
    contactPhone: profile?.contactPhone ?? '',
    district: (profile?.district as District | null) ?? '',
    city: profile?.city ?? '',
    addressLine1: profile?.addressLine1 ?? '',
    operatingLicenceNumber: profile?.operatingLicenceNumber ?? '',
    operatingLicenceExpiry: toDateInputValue(profile?.operatingLicenceExpiry),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put('/passenger/provider/profile', {
        businessName: f.businessName,
        description: f.description || undefined,
        contactEmail: f.contactEmail,
        contactPhone: f.contactPhone || undefined,
        district: f.district || undefined,
        city: f.city || undefined,
        addressLine1: f.addressLine1 || undefined,
        operatingLicenceNumber: f.operatingLicenceNumber || undefined,
        operatingLicenceExpiry: f.operatingLicenceExpiry || undefined,
      });
      setMsg('Profile saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const expiryStatus = profile?.operatingLicenceExpiryStatus;

  return (
    <Card title="Business profile">
      {msg && (
        <Alert tone="success" className="mb-4">
          {msg}
        </Alert>
      )}
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="opBusinessName">
            <Input id="opBusinessName" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} required />
          </Field>
          <Field label="Contact email" htmlFor="opContactEmail">
            <Input
              id="opContactEmail"
              type="email"
              value={f.contactEmail}
              onChange={(e) => setF({ ...f, contactEmail: e.target.value })}
              required
            />
          </Field>
          <Field label="Contact phone" htmlFor="opContactPhone" hint="Optional">
            <Input
              id="opContactPhone"
              type="tel"
              inputMode="tel"
              value={f.contactPhone}
              onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
            />
          </Field>
          <Field label="District" htmlFor="opDistrict" hint="Optional">
            <Select id="opDistrict" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value as District | '' })}>
              <option value="">—</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Town / city" htmlFor="opCity" hint="Optional">
            <Input id="opCity" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label="Address" htmlFor="opAddress" hint="Optional">
            <Input id="opAddress" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
          </Field>
        </div>

        <Field label="About your service" htmlFor="opDescription" hint="Optional — shown to riders.">
          <Textarea id="opDescription" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Public transport licence number" htmlFor="opLicenceNumber" hint="Optional">
            <Input
              id="opLicenceNumber"
              value={f.operatingLicenceNumber}
              onChange={(e) => setF({ ...f, operatingLicenceNumber: e.target.value })}
            />
          </Field>
          <Field label="Licence expiry" htmlFor="opLicenceExpiry" hint="Optional">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="opLicenceExpiry"
                type="date"
                className="min-w-0 flex-1"
                value={f.operatingLicenceExpiry}
                onChange={(e) => setF({ ...f, operatingLicenceExpiry: e.target.value })}
              />
              {expiryStatus && <Badge tone={expiryTone(expiryStatus)}>{expiryStatus.replace('_', ' ')}</Badge>}
            </div>
          </Field>
        </div>

        <Button className="w-full sm:w-auto" disabled={busy || !f.businessName || !f.contactEmail}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}
