'use client';

import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/uploads';
import { Avatar } from '../Avatar';
import { Alert, Badge, Button, Field, Input, Label, Select, Spinner, Textarea } from '../ui';
import {
  Card,
  DISTRICTS,
  districtLabel,
  errMessage,
  expiryTone,
  toDateInputValue,
  type DriverProfile,
} from './dashboard-data';

/**
 * The driver's own details — name, contact, licence and profile photo.
 *
 * Unchanged in substance from the version that lived inside the single driver
 * page; it now has its own route so the navigation can point at "Driver Profile"
 * and land somewhere, instead of asking the driver to scroll.
 */
export function ProfileEditor({ profile, onDone }: { profile: DriverProfile | null; onDone: () => Promise<void> }) {
  const [f, setF] = useState({
    legalName: profile?.legalName ?? '',
    displayName: profile?.displayName ?? '',
    phone: profile?.phone ?? '',
    homeDistrict: profile?.homeDistrict ?? DISTRICTS[0],
    homeAddress: profile?.homeAddress ?? '',
    emergencyContactName: profile?.emergencyContactName ?? '',
    emergencyContactPhone: profile?.emergencyContactPhone ?? '',
    licenceNumber: profile?.licenceNumber ?? '',
    licenceExpiry: toDateInputValue(profile?.licenceExpiry),
    vehicleOwnership: profile?.vehicleOwnership ?? 'NONE',
    termsAccepted: profile?.termsAccepted ?? false,
    applicantNotes: profile?.applicantNotes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put('/driver/profile', {
        legalName: f.legalName,
        displayName: f.displayName,
        phone: f.phone,
        homeDistrict: f.homeDistrict,
        homeAddress: f.homeAddress || undefined,
        emergencyContactName: f.emergencyContactName || undefined,
        emergencyContactPhone: f.emergencyContactPhone || undefined,
        licenceNumber: f.licenceNumber,
        licenceExpiry: f.licenceExpiry,
        vehicleOwnership: f.vehicleOwnership,
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

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    setErr(null);
    try {
      const key = await uploadFile('/driver/profile/photo/upload', file);
      await api.patch('/driver/profile', { profilePhotoKey: key });
      setMsg('Profile photo updated.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  const expiryStatus = profile?.licenceExpiryStatus;

  return (
    <Card title="Driver profile">
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
          <Field label="Legal name" htmlFor="legalName">
            <Input id="legalName" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} required />
          </Field>
          <Field label="Display name" htmlFor="displayName">
            <Input id="displayName" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
          </Field>
          <Field label="Home district" htmlFor="homeDistrict">
            <Select id="homeDistrict" value={f.homeDistrict} onChange={(e) => setF({ ...f, homeDistrict: e.target.value })}>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {districtLabel(d)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Home address" htmlFor="homeAddress" hint="Optional">
          <Input id="homeAddress" value={f.homeAddress} onChange={(e) => setF({ ...f, homeAddress: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Emergency contact name" htmlFor="emergencyContactName" hint="Optional">
            <Input
              id="emergencyContactName"
              value={f.emergencyContactName}
              onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })}
            />
          </Field>
          <Field label="Emergency contact phone" htmlFor="emergencyContactPhone" hint="Optional">
            <Input
              id="emergencyContactPhone"
              type="tel"
              inputMode="tel"
              value={f.emergencyContactPhone}
              onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Licence number" htmlFor="licenceNumber">
            <Input id="licenceNumber" value={f.licenceNumber} onChange={(e) => setF({ ...f, licenceNumber: e.target.value })} required />
          </Field>
          <Field label="Licence expiry" htmlFor="licenceExpiry">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="licenceExpiry"
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

        <Field label="Vehicle ownership" htmlFor="vehicleOwnership">
          <Select
            id="vehicleOwnership"
            value={f.vehicleOwnership}
            onChange={(e) => setF({ ...f, vehicleOwnership: e.target.value as DriverProfile['vehicleOwnership'] })}
          >
            <option value="OWNED">Owned</option>
            <option value="LEASED">Leased</option>
            <option value="BORROWED">Borrowed</option>
            <option value="NONE">None</option>
          </Select>
        </Field>

        <Field label="Applicant notes" htmlFor="applicantNotes" hint="Optional — anything you&rsquo;d like reviewers to know.">
          <Textarea id="applicantNotes" rows={3} value={f.applicantNotes} onChange={(e) => setF({ ...f, applicantNotes: e.target.value })} />
        </Field>

        <div>
          <Label>Profile photo</Label>
          <p className="mt-0.5 text-xs text-slate-500">
            Customers see this photo when you’re on your way to them, so they know who to expect.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* Show the actual photo. A "Photo on file" badge with nothing beside
                it is indistinguishable from a broken upload. */}
            <Avatar name={f.displayName || f.legalName || 'Driver'} src={profile?.profilePhotoUrl} size="lg" />
            <div className="flex flex-col gap-1.5">
              {profile?.hasProfilePhoto ? <Badge tone="success">Photo on file</Badge> : <Badge tone="neutral">No photo yet</Badge>}
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
                {photoBusy ? <Spinner className="h-4 w-4" /> : profile?.hasProfilePhoto ? 'Replace photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={photoBusy}
                  onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.termsAccepted}
            onChange={(e) => setF({ ...f, termsAccepted: e.target.checked })}
          />
          I accept the driver terms &amp; conditions.
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
