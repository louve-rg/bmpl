'use client';

import { useState, type FormEvent } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Button, Field, Input, Select, Textarea } from '../ui';
import { Card, errMessage, toDateInputValue } from '../driver/dashboard-data';
import type { ShippingProviderProfile } from '../../lib/shipping-provider';

/**
 * The carrier's organization profile — the application data an applicant
 * builds before the SHIPPING_PROVIDER role (and separately, the
 * organization's own status) is approved, and edits after. Mirrors
 * `passenger-operator/ProfileForm.tsx` field-for-field — same idea, same
 * shape (`shippingProviderProfileSchema` mirrors
 * `passengerProviderProfileSchema` field for field server-side too).
 */
export function CarrierProfileForm({ profile, onDone }: { profile: ShippingProviderProfile | null; onDone: () => Promise<void> }) {
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
      await api.put('/shipping/provider/profile', {
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

  return (
    <Card title="Organization profile">
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
          <Field label="Business name" htmlFor="spBusinessName">
            <Input id="spBusinessName" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} required />
          </Field>
          <Field label="Contact email" htmlFor="spContactEmail">
            <Input
              id="spContactEmail"
              type="email"
              value={f.contactEmail}
              onChange={(e) => setF({ ...f, contactEmail: e.target.value })}
              required
            />
          </Field>
          <Field label="Contact phone" htmlFor="spContactPhone" hint="Optional">
            <Input
              id="spContactPhone"
              type="tel"
              inputMode="tel"
              value={f.contactPhone}
              onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
            />
          </Field>
          <Field label="District" htmlFor="spDistrict" hint="Optional">
            <Select id="spDistrict" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value as District | '' })}>
              <option value="">—</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Town / city" htmlFor="spCity" hint="Optional">
            <Input id="spCity" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label="Address" htmlFor="spAddress" hint="Optional">
            <Input id="spAddress" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
          </Field>
        </div>

        <Field label="About your organization" htmlFor="spDescription" hint="Optional — shown to BML staff, never to customers.">
          <Textarea id="spDescription" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Operating / transport licence number" htmlFor="spLicenceNumber" hint="Optional">
            <Input
              id="spLicenceNumber"
              value={f.operatingLicenceNumber}
              onChange={(e) => setF({ ...f, operatingLicenceNumber: e.target.value })}
            />
          </Field>
          <Field label="Licence expiry" htmlFor="spLicenceExpiry" hint="Optional">
            <Input
              id="spLicenceExpiry"
              type="date"
              value={f.operatingLicenceExpiry}
              onChange={(e) => setF({ ...f, operatingLicenceExpiry: e.target.value })}
            />
          </Field>
        </div>

        <Button className="w-full sm:w-auto" disabled={busy || !f.businessName || !f.contactEmail}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}
