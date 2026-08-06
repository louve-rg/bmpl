'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { uploadFile } from '../../../lib/uploads';
import { StarRating } from '../../../components/reviews/StarRating';
import {
  Card as UiCard,
  PageHeader,
  Field,
  Input,
  Textarea,
  Select,
  Label,
  Button,
  ButtonLink,
  Badge,
  StatusBadge,
  Alert,
  Spinner,
  EmptyState,
  type Tone,
} from '../../../components/ui';

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];

const VEHICLE_TYPES: Array<{ value: Vehicle['type']; label: string }> = [
  { value: 'CAR', label: 'Car' },
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'SCOOTER', label: 'Scooter' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'VAN', label: 'Van' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'OTHER', label: 'Other' },
];

/* --------------------------------------------------------------- helpers */

function districtLabel(d: string): string {
  return d
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function toDateInputValue(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}
function expiryTone(status?: string | null): Tone {
  switch (status) {
    case 'VALID':
      return 'success';
    case 'EXPIRING_SOON':
      return 'warning';
    case 'EXPIRED':
      return 'error';
    default:
      return 'neutral';
  }
}

/* --------------------------------------------------------------- types */

type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;

interface Application {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  reviewerNote: string | null;
}

interface DriverProfile {
  id?: string;
  legalName: string;
  displayName: string;
  phone: string;
  homeDistrict: string;
  homeAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  licenceNumber: string;
  licenceExpiry: string | null;
  licenceExpiryStatus?: ExpiryStatus;
  vehicleOwnership: 'OWNED' | 'LEASED' | 'BORROWED' | 'NONE';
  availability: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
  isActive?: boolean;
  ratingAverage?: number | null;
  completedDeliveries?: number;
  hasProfilePhoto?: boolean;
  termsAccepted?: boolean;
  applicantNotes?: string | null;
}

interface Vehicle {
  id: string;
  type: 'CAR' | 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'VAN' | 'TRUCK' | 'OTHER';
  make: string;
  model: string;
  year?: number | null;
  color?: string | null;
  licencePlate: string;
  registrationNumber?: string | null;
  registrationExpiry?: string | null;
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiry?: string | null;
  photoUrls: string[];
  isPrimary: boolean;
  isActive: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  registrationExpiryStatus?: ExpiryStatus;
  insuranceExpiryStatus?: ExpiryStatus;
}

interface ServiceArea {
  district: string;
  isActive: boolean;
}

interface Eligibility {
  canGoOnline: boolean;
  reasons: string[];
}

interface DashboardData {
  hasProfile: boolean;
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | 'REJECTED' | null;
  application: Application | null;
  profile: DriverProfile | null;
  vehicles: Vehicle[];
  serviceAreas: ServiceArea[];
  eligibility: Eligibility;
}

/* ----------------------------------------------------------------- page */

export default function DriverPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const d = await api.get<DashboardData>('/driver/dashboard');
      setData(d);
      setError(null);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Delivery Driver" description="Manage your driver profile, vehicles, service areas, and availability." />

      {error && <Alert tone="error">{error}</Alert>}

      {data && (
        <>
          <StatusBanner hasProfile={data.hasProfile} roleStatus={data.roleStatus} application={data.application} />
          <DocumentsCallout />

          {data.profile && <AvailabilityControl profile={data.profile} eligibility={data.eligibility} onDone={reload} />}

          {data.profile && <RatingSummary profile={data.profile} />}

          <ProfileEditor profile={data.profile} onDone={reload} />
          <VehicleManager vehicles={data.vehicles} onDone={reload} />
          <ServiceAreasSection serviceAreas={data.serviceAreas} onDone={reload} />

          <UiCard className="p-5 sm:p-6">
            <h2 className="bmpl-eyebrow mb-2">Delivery jobs</h2>
            <p className="mb-4 text-sm text-slate-500">View and manage your assigned deliveries — accept jobs, confirm pickups, and complete drop-offs.</p>
            <ButtonLink href="/dashboard/driver/jobs" size="sm">
              Go to my deliveries
            </ButtonLink>
          </UiCard>

          <UiCard className="p-5 sm:p-6">
            <h2 className="bmpl-eyebrow mb-2">Earnings</h2>
            <p className="mb-4 text-sm text-slate-500">Track your delivery earnings and see a transparent breakdown of how each one was calculated.</p>
            <ButtonLink href="/dashboard/driver/earnings" size="sm">
              View my earnings
            </ButtonLink>
          </UiCard>
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <UiCard className="p-5 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">{title}</h2>
      {children}
    </UiCard>
  );
}

/* -------------------------------------------------------- rating summary */

function RatingSummary({ profile }: { profile: DriverProfile }) {
  const average = profile.ratingAverage ?? 0;
  const completed = profile.completedDeliveries ?? 0;
  return (
    <Card title="Your rating">
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-belize-navy">{average > 0 ? average.toFixed(1) : '—'}</span>
          <StarRating value={average} size="md" className="mt-1" />
        </div>
        <div className="text-sm text-slate-500">
          <p>
            <span className="font-semibold text-belize-navy">{completed}</span> completed deliver{completed === 1 ? 'y' : 'ies'}
          </p>
          {average === 0 && <p className="mt-0.5 text-xs">No ratings yet — complete deliveries to start building your rating.</p>}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- status banner */

function StatusBanner({
  hasProfile,
  roleStatus,
  application,
}: {
  hasProfile: boolean;
  roleStatus: DashboardData['roleStatus'];
  application: Application | null;
}) {
  let tone: Tone = 'info';
  let title = '';
  let body: ReactNode = null;

  if (roleStatus === 'APPROVED') {
    tone = 'success';
    title = 'Approved driver';
  } else if (roleStatus === 'PENDING') {
    tone = 'info';
    title = 'Application under review';
  } else if (roleStatus === 'SUSPENDED') {
    tone = 'error';
    title = 'Role suspended';
  } else if (roleStatus === 'REJECTED') {
    tone = 'error';
    title = 'Application rejected';
  } else if (roleStatus === 'REVOKED') {
    tone = 'error';
    title = 'Role revoked';
  } else if (!hasProfile) {
    tone = 'info';
    title = 'Become a delivery driver';
    body = 'Complete your profile and submit your application to start delivering.';
  } else {
    tone = 'info';
    title = 'Profile saved';
    body = 'Submit your driver application from My Roles to get approved for deliveries.';
  }

  return (
    <div className="space-y-3">
      <Alert tone={tone} title={title}>
        {body}
      </Alert>
      {application?.reviewerNote && (
        <Alert tone="info" title="Note from reviewer">
          {application.reviewerNote}
        </Alert>
      )}
    </div>
  );
}

function DocumentsCallout() {
  return (
    <Card title="Application & documents">
      <p className="text-sm text-slate-600">
        Required documents — ID, driver&rsquo;s licence, vehicle registration, insurance, and vehicle &amp; profile photos — are uploaded
        as part of your role application.
      </p>
      <div className="mt-4">
        <ButtonLink href="/dashboard/roles" variant="outline" size="sm">
          Manage application &amp; documents
        </ButtonLink>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ availability */

function AvailabilityControl({
  profile,
  eligibility,
  onDone,
}: {
  profile: DriverProfile;
  eligibility: Eligibility;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = profile.availability;
  const suspended = current === 'SUSPENDED';

  const options: Array<{ value: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE'; label: string }> = [
    { value: 'OFFLINE', label: 'Offline' },
    { value: 'ONLINE', label: 'Online' },
    { value: 'UNAVAILABLE', label: 'Unavailable' },
  ];

  async function setAvailability(v: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE') {
    setBusy(true);
    setErr(null);
    try {
      await api.patch('/driver/availability', { availability: v });
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const badgeTone: Tone = suspended ? 'error' : current === 'ONLINE' ? 'success' : current === 'UNAVAILABLE' ? 'warning' : 'neutral';

  return (
    <Card title="Availability">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">Current status:</span>
        <Badge tone={badgeTone}>{current}</Badge>
      </div>

      {err && (
        <Alert tone="error" className="mb-3">
          {err}
        </Alert>
      )}

      {suspended ? (
        <p className="text-sm text-slate-500">Your driver role is suspended, so availability can&rsquo;t be changed.</p>
      ) : (
        <>
          <div className="inline-flex overflow-hidden rounded-bmpl-md border border-slate-200" role="group" aria-label="Set availability">
            {options.map((o, i) => {
              const active = current === o.value;
              const disabled = busy || (o.value === 'ONLINE' && !eligibility.canGoOnline);
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => setAvailability(o.value)}
                  className={`px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    i > 0 ? 'border-l border-slate-200' : ''
                  } ${active ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {!eligibility.canGoOnline && eligibility.reasons.length > 0 && (
            <p className="mt-2 text-xs text-amber-600">Can&rsquo;t go online: {eligibility.reasons.join('; ')}</p>
          )}
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- profile form */

function ProfileEditor({ profile, onDone }: { profile: DriverProfile | null; onDone: () => Promise<void> }) {
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
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Legal name" htmlFor="legalName">
            <Input id="legalName" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} required />
          </Field>
          <Field label="Display name" htmlFor="displayName">
            <Input id="displayName" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
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

        <div className="grid gap-4 md:grid-cols-2">
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
              value={f.emergencyContactPhone}
              onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Licence number" htmlFor="licenceNumber">
            <Input id="licenceNumber" value={f.licenceNumber} onChange={(e) => setF({ ...f, licenceNumber: e.target.value })} required />
          </Field>
          <Field label="Licence expiry" htmlFor="licenceExpiry">
            <div className="flex items-center gap-2">
              <Input
                id="licenceExpiry"
                type="date"
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
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {profile?.hasProfilePhoto ? <Badge tone="success">Photo on file</Badge> : <Badge tone="neutral">No photo yet</Badge>}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
              {photoBusy ? <Spinner className="h-4 w-4" /> : 'Upload photo'}
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

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.termsAccepted}
            onChange={(e) => setF({ ...f, termsAccepted: e.target.checked })}
          />
          I accept the driver terms &amp; conditions.
        </label>

        <Button
          disabled={busy || !f.legalName || !f.displayName || !f.phone || !f.licenceNumber || !f.licenceExpiry || !f.termsAccepted}
        >
          Save profile
        </Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------- vehicle manager */

function VehicleManager({ vehicles, onDone }: { vehicles: Vehicle[]; onDone: () => Promise<void> }) {
  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card title="Vehicles">
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}

      {vehicles.length === 0 && !addingOpen && (
        <EmptyState title="No vehicles yet" description="Add a vehicle to start receiving delivery jobs." />
      )}

      {vehicles.length > 0 && (
        <ul className="mb-4 space-y-3">
          {vehicles.map((v) =>
            editingId === v.id ? (
              <li key={v.id}>
                <VehicleForm
                  vehicle={v}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    setErr(null);
                    await onDone();
                  }}
                  onError={setErr}
                />
              </li>
            ) : (
              <VehicleRow
                key={v.id}
                vehicle={v}
                onEdit={() => {
                  setErr(null);
                  setEditingId(v.id);
                }}
                onChanged={async () => {
                  setErr(null);
                  await onDone();
                }}
                onError={setErr}
              />
            ),
          )}
        </ul>
      )}

      {addingOpen ? (
        <VehicleForm
          onCancel={() => setAddingOpen(false)}
          onSaved={async () => {
            setAddingOpen(false);
            setErr(null);
            await onDone();
          }}
          onError={setErr}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAddingOpen(true)}>
          + Add vehicle
        </Button>
      )}
    </Card>
  );
}

function VehicleRow({
  vehicle,
  onEdit,
  onChanged,
  onError,
}: {
  vehicle: Vehicle;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const typeLabel = VEHICLE_TYPES.find((t) => t.value === vehicle.type)?.label ?? vehicle.type;

  return (
    <li className="rounded-bmpl-md border border-slate-100 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">
              {vehicle.year ? `${vehicle.year} ` : ''}
              {vehicle.make} {vehicle.model}
            </b>
            <Badge tone="brand">{typeLabel}</Badge>
            {vehicle.isPrimary && <Badge tone="success">Primary</Badge>}
            <StatusBadge status={vehicle.approvalStatus} />
            {!vehicle.isActive && <Badge tone="neutral">Inactive</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">Plate: {vehicle.licencePlate}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {vehicle.registrationExpiryStatus && (
              <Badge tone={expiryTone(vehicle.registrationExpiryStatus)}>
                Registration: {vehicle.registrationExpiryStatus.replace('_', ' ')}
              </Badge>
            )}
            {vehicle.insuranceExpiryStatus && (
              <Badge tone={expiryTone(vehicle.insuranceExpiryStatus)}>Insurance: {vehicle.insuranceExpiryStatus.replace('_', ' ')}</Badge>
            )}
          </div>
          {vehicle.rejectionReason && <p className="mt-1.5 text-xs text-red-600">Reason: {vehicle.rejectionReason}</p>}
          {vehicle.photoUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {vehicle.photoUrls.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt="" className="h-12 w-12 rounded-bmpl-md border border-slate-200 object-cover" />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!vehicle.isPrimary && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.patch(`/driver/vehicles/${vehicle.id}`, { isPrimary: true });
                  await onChanged();
                } catch (e) {
                  onError(errMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set primary
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.del(`/driver/vehicles/${vehicle.id}`);
                await onChanged();
              } catch (e) {
                onError(errMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

function VehicleForm({
  vehicle,
  onCancel,
  onSaved,
  onError,
}: {
  vehicle?: Vehicle;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const isEdit = !!vehicle;
  const idBase = vehicle?.id ?? 'new';
  const [f, setF] = useState({
    type: vehicle?.type ?? 'CAR',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year != null ? String(vehicle.year) : '',
    color: vehicle?.color ?? '',
    licencePlate: vehicle?.licencePlate ?? '',
    registrationNumber: vehicle?.registrationNumber ?? '',
    registrationExpiry: toDateInputValue(vehicle?.registrationExpiry),
    insuranceProvider: vehicle?.insuranceProvider ?? '',
    insurancePolicyNumber: vehicle?.insurancePolicyNumber ?? '',
    insuranceExpiry: toDateInputValue(vehicle?.insuranceExpiry),
    isPrimary: vehicle?.isPrimary ?? false,
    isActive: vehicle?.isActive ?? true,
  });
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function addPhoto(file: File) {
    setPhotoBusy(true);
    onError('');
    try {
      const key = await uploadFile('/driver/vehicles/photo/upload', file);
      setPhotoKeys((k) => [...k, key]);
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      const body: Record<string, unknown> = {
        type: f.type,
        make: f.make,
        model: f.model,
        year: f.year.trim() === '' ? undefined : Number(f.year),
        color: f.color || undefined,
        licencePlate: f.licencePlate,
        registrationNumber: f.registrationNumber || undefined,
        registrationExpiry: f.registrationExpiry || undefined,
        insuranceProvider: f.insuranceProvider || undefined,
        insurancePolicyNumber: f.insurancePolicyNumber || undefined,
        insuranceExpiry: f.insuranceExpiry || undefined,
        isPrimary: f.isPrimary,
      };
      if (photoKeys.length > 0) body.photoKeys = photoKeys;
      if (isEdit) {
        body.isActive = f.isActive;
        await api.patch(`/driver/vehicles/${vehicle!.id}`, body);
      } else {
        await api.post('/driver/vehicles', body);
      }
      await onSaved();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-bmpl-md border border-belize-blue/30 bg-belize-blue/5 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type" htmlFor={`type-${idBase}`}>
          <Select id={`type-${idBase}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Vehicle['type'] })}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Licence plate" htmlFor={`plate-${idBase}`}>
          <Input id={`plate-${idBase}`} value={f.licencePlate} onChange={(e) => setF({ ...f, licencePlate: e.target.value })} required />
        </Field>
        <Field label="Make" htmlFor={`make-${idBase}`}>
          <Input id={`make-${idBase}`} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} required />
        </Field>
        <Field label="Model" htmlFor={`model-${idBase}`}>
          <Input id={`model-${idBase}`} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} required />
        </Field>
        <Field label="Year" htmlFor={`year-${idBase}`} hint="Optional">
          <Input id={`year-${idBase}`} inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        </Field>
        <Field label="Color" htmlFor={`color-${idBase}`} hint="Optional">
          <Input id={`color-${idBase}`} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </Field>
        <Field label="Registration number" htmlFor={`regno-${idBase}`} hint="Optional">
          <Input id={`regno-${idBase}`} value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
        </Field>
        <Field label="Registration expiry" htmlFor={`regexp-${idBase}`} hint="Optional">
          <Input
            id={`regexp-${idBase}`}
            type="date"
            value={f.registrationExpiry}
            onChange={(e) => setF({ ...f, registrationExpiry: e.target.value })}
          />
        </Field>
        <Field label="Insurance provider" htmlFor={`insprov-${idBase}`} hint="Optional">
          <Input id={`insprov-${idBase}`} value={f.insuranceProvider} onChange={(e) => setF({ ...f, insuranceProvider: e.target.value })} />
        </Field>
        <Field label="Insurance policy number" htmlFor={`inspol-${idBase}`} hint="Optional">
          <Input
            id={`inspol-${idBase}`}
            value={f.insurancePolicyNumber}
            onChange={(e) => setF({ ...f, insurancePolicyNumber: e.target.value })}
          />
        </Field>
        <Field label="Insurance expiry" htmlFor={`insexp-${idBase}`} hint="Optional">
          <Input
            id={`insexp-${idBase}`}
            type="date"
            value={f.insuranceExpiry}
            onChange={(e) => setF({ ...f, insuranceExpiry: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.isPrimary}
            onChange={(e) => setF({ ...f, isPrimary: e.target.checked })}
          />
          Primary vehicle
        </label>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
              checked={f.isActive}
              onChange={(e) => setF({ ...f, isActive: e.target.checked })}
            />
            Active
          </label>
        )}
      </div>

      <div>
        <Label>Vehicle photos</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {vehicle?.photoUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-12 w-12 rounded-bmpl-md border border-slate-200 object-cover" />
          ))}
          {photoKeys.map((k) => (
            <Badge key={k} tone="success">
              Photo added
            </Badge>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
            {photoBusy ? <Spinner className="h-4 w-4" /> : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={photoBusy}
              onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !f.make || !f.model || !f.licencePlate}>
          {isEdit ? 'Save vehicle' : 'Add vehicle'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------- service areas */

function ServiceAreasSection({ serviceAreas, onDone }: { serviceAreas: ServiceArea[]; onDone: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>(serviceAreas.filter((a) => a.isActive).map((a) => a.district));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put('/driver/service-areas', { districts: selected });
      setMsg('Service areas saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Service areas">
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
      <fieldset>
        <legend className="bmpl-label mb-1.5">Districts you can deliver in</legend>
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          {DISTRICTS.map((d) => {
            const id = `sa-${d}`;
            const checked = selected.includes(d);
            return (
              <label key={d} htmlFor={id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  id={id}
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
                  checked={checked}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, d] : selected.filter((x) => x !== d))}
                />
                {districtLabel(d)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <Button type="button" disabled={busy} onClick={save}>
        Save service areas
      </Button>
    </Card>
  );
}
