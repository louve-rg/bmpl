'use client';

import { useState, type FormEvent } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '../ui';
import { Card, errMessage, expiryTone, toDateInputValue } from '../driver/dashboard-data';
import type { PassengerDriverProfile } from '../../lib/passenger-driver';

/**
 * The passenger driver's own details — the application data an applicant
 * builds before the PASSENGER_DRIVER role is approved, and edits after.
 *
 * No photo upload here on purpose: the passenger API deliberately accepts no
 * storage keys yet (no passenger upload surface exists), so offering an
 * upload would promise something the backend refuses.
 */
export function ProfileForm({ profile, onDone }: { profile: PassengerDriverProfile | null; onDone: () => Promise<void> }) {
  const [f, setF] = useState({
    legalName: profile?.legalName ?? '',
    displayName: profile?.displayName ?? '',
    phone: profile?.phone ?? '',
    homeDistrict: (profile?.homeDistrict as District) ?? DISTRICTS[0],
    homeAddress: profile?.homeAddress ?? '',
    emergencyContactName: profile?.emergencyContactName ?? '',
    emergencyContactPhone: profile?.emergencyContactPhone ?? '',
    licenceNumber: profile?.licenceNumber ?? '',
    licenceExpiry: toDateInputValue(profile?.licenceExpiry),
    termsAccepted: !!profile,
    applicantNotes: '',
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
      await api.put('/passenger/driver/profile', {
        legalName: f.legalName,
        displayName: f.displayName,
        phone: f.phone,
        homeDistrict: f.homeDistrict,
        homeAddress: f.homeAddress || undefined,
        emergencyContactName: f.emergencyContactName || undefined,
        emergencyContactPhone: f.emergencyContactPhone || undefined,
        licenceNumber: f.licenceNumber,
        licenceExpiry: f.licenceExpiry,
        termsAccepted: f.termsAccepted,
        applicantNotes: f.applicantNotes || undefined,
      });
      setMsg('Profile saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const expiryStatus = profile?.licenceExpiryStatus;

  return (
    <Card title="Passenger-driver profile">
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
          <Field label="Legal name" htmlFor="pdLegalName">
            <Input id="pdLegalName" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} required />
          </Field>
          <Field label="Display name" htmlFor="pdDisplayName">
            <Input id="pdDisplayName" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required />
          </Field>
          <Field label="Phone" htmlFor="pdPhone">
            <Input id="pdPhone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
          </Field>
          <Field label="Home district" htmlFor="pdHomeDistrict">
            <Select
              id="pdHomeDistrict"
              value={f.homeDistrict}
              onChange={(e) => setF({ ...f, homeDistrict: e.target.value as District })}
            >
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Home address" htmlFor="pdHomeAddress" hint="Optional">
          <Input id="pdHomeAddress" value={f.homeAddress} onChange={(e) => setF({ ...f, homeAddress: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Emergency contact name" htmlFor="pdEmergencyName" hint="Optional">
            <Input
              id="pdEmergencyName"
              value={f.emergencyContactName}
              onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })}
            />
          </Field>
          <Field label="Emergency contact phone" htmlFor="pdEmergencyPhone" hint="Optional">
            <Input
              id="pdEmergencyPhone"
              type="tel"
              inputMode="tel"
              value={f.emergencyContactPhone}
              onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Licence number" htmlFor="pdLicenceNumber">
            <Input id="pdLicenceNumber" value={f.licenceNumber} onChange={(e) => setF({ ...f, licenceNumber: e.target.value })} required />
          </Field>
          <Field label="Licence expiry" htmlFor="pdLicenceExpiry">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="pdLicenceExpiry"
                type="date"
                className="min-w-0 flex-1"
                value={f.licenceExpiry}
                onChange={(e) => setF({ ...f, licenceExpiry: e.target.value })}
                required
              />
              {expiryStatus && <Badge tone={expiryTone(expiryStatus)}>{expiryStatus.replace('_', ' ')}</Badge>}
            </div>
          </Field>
        </div>

        <Field label="Applicant notes" htmlFor="pdApplicantNotes" hint="Optional — anything you&rsquo;d like reviewers to know.">
          <Textarea id="pdApplicantNotes" rows={3} value={f.applicantNotes} onChange={(e) => setF({ ...f, applicantNotes: e.target.value })} />
        </Field>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.termsAccepted}
            onChange={(e) => setF({ ...f, termsAccepted: e.target.checked })}
          />
          I accept the passenger-driver terms &amp; conditions.
        </label>

        <Button
          className="w-full sm:w-auto"
          disabled={busy || !f.legalName || !f.displayName || !f.phone || !f.licenceNumber || !f.licenceExpiry || !f.termsAccepted}
        >
          Save profile
        </Button>
      </form>
    </Card>
  );
}
