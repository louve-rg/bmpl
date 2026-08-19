'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Coordinates } from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import { uploadFile } from '../../../lib/uploads';

/** Browser-only: Leaflet touches `window` at import time. Same picker the
 *  customer uses at checkout, so vendors and customers pin the same way. */
const LocationPicker = dynamic(
  () => import('../../../components/maps/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => <div className="h-64 w-full animate-pulse rounded-bmpl-md border border-slate-200 bg-slate-100" aria-hidden />,
  },
);
import { centsToDollars, dollarsToCentsOrNull } from '../../../lib/money-input';
import {
  Card as UiCard,
  PageHeader,
  Field,
  Input,
  Textarea,
  Select,
  Button,
  ButtonLink,
  Badge,
  StatusBadge,
  Alert,
  Spinner,
} from '../../../components/ui';

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Store {
  profile: {
    id: string;
    businessName: string;
    slug: string;
    description: string | null;
    contactEmail: string;
    contactPhone: string | null;
    website: string | null;
    approvalStatus: string;
    storeStatus: string;
    rejectionReason: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
  } | null;
  settings?: {
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    vacationMode: boolean;
    hideOutOfStock: boolean;
    minimumOrderMinor: number | null;
  };
  locations?: Array<{
    id: string;
    label: string;
    addressLine1: string;
    city: string;
    district: string;
    isPrimary: boolean;
    latitude?: number | null;
    longitude?: number | null;
    pickupInstructions?: string | null;
  }>;
  openingHours?: Array<{ dayOfWeek: number; isClosed: boolean; openTime: string | null; closeTime: string | null }>;
}

export default function StorePage() {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setStore(await api.get<Store>('/vendor/profile'));
  }
  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, []);

  function fail(e: unknown) {
    setMsg((e as ApiError).message ?? 'Something went wrong.');
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="My Store" />
      {msg && <Alert tone="warning">{msg}</Alert>}

      {!store?.profile ? (
        <CreateForm onDone={reload} onError={fail} />
      ) : (
        <>
          <StatusBar store={store} onDone={reload} onError={fail} />
          <ProfileForm store={store} onDone={reload} onError={fail} />
          <ImagesSection store={store} onDone={reload} onError={fail} />
          <SettingsForm store={store} onDone={reload} onError={fail} />
          <LocationsSection store={store} onDone={reload} onError={fail} />
          <HoursSection store={store} onDone={reload} onError={fail} />
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <UiCard className="p-5 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">{title}</h2>
      {children}
    </UiCard>
  );
}

type SectionProps = { store: Store; onDone: () => Promise<void>; onError: (e: unknown) => void };

function CreateForm({ onDone, onError }: { onDone: () => Promise<void>; onError: (e: unknown) => void }) {
  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Create your storefront">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/vendor/profile', { businessName, contactEmail });
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Business name">
          <Input placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </Field>
        <Field label="Contact email">
          <Input placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </Field>
        <Button disabled={busy || !businessName || !contactEmail}>Create storefront</Button>
      </form>
    </Card>
  );
}

function StatusBar({ store, onDone, onError }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const status = store.profile!.approvalStatus;
  const canSubmit = status === 'DRAFT' || status === 'REJECTED';
  return (
    <UiCard className="flex flex-wrap items-center gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>Approval:</span>
        <StatusBadge status={status} />
        <span className="text-slate-300">·</span>
        <span>
          Store: <b className="text-belize-navy">{store.profile!.storeStatus}</b>
        </span>
        {store.profile!.rejectionReason && status === 'REJECTED' && (
          <span className="text-red-600">Reason: {store.profile!.rejectionReason}</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <ButtonLink href="/dashboard/store/preview" variant="outline" size="sm">
          Preview storefront
        </ButtonLink>
        {canSubmit && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/vendor/profile/submit');
                await onDone();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit for review
          </Button>
        )}
        {status === 'PENDING' && <span className="text-sm text-slate-500">Awaiting admin review…</span>}
        {status === 'APPROVED' && <Badge tone="success">Live ✓</Badge>}
      </div>
    </UiCard>
  );
}

function ProfileForm({ store, onDone, onError }: SectionProps) {
  const p = store.profile!;
  const [f, setF] = useState({
    businessName: p.businessName,
    description: p.description ?? '',
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone ?? '',
    website: p.website ?? '',
    storeStatus: p.storeStatus,
  });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Business details">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.patch('/vendor/profile', {
              businessName: f.businessName,
              description: f.description,
              contactEmail: f.contactEmail,
              contactPhone: f.contactPhone,
              website: f.website,
              storeStatus: f.storeStatus,
            });
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Business name">
          <Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Business name" />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Contact email">
            <Input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="Contact email" />
          </Field>
          <Field label="Contact phone">
            <Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="Contact phone" />
          </Field>
        </div>
        <Field label="Website">
          <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" />
        </Field>
        <Field label="Store status">
          <Select value={f.storeStatus} onChange={(e) => setF({ ...f, storeStatus: e.target.value })}>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </Field>
        <Button disabled={busy}>Save details</Button>
      </form>
    </Card>
  );
}

function ImagesSection({ store, onDone, onError }: SectionProps) {
  const p = store.profile!;
  async function upload(kind: 'logo' | 'banner', file: File) {
    try {
      const key = await uploadFile(`/vendor/profile/${kind}/upload`, file);
      await api.post(`/vendor/profile/${kind}/confirm`, { key });
      await onDone();
    } catch (e) {
      onError(e);
    }
  }
  return (
    <Card title="Branding">
      <div className="flex flex-wrap gap-6">
        <ImagePicker label="Logo" url={p.logoUrl} onPick={(file) => upload('logo', file)} />
        <ImagePicker label="Banner" url={p.bannerUrl} onPick={(file) => upload('banner', file)} wide />
      </div>
      <p className="mt-3 text-xs text-slate-400">JPEG, PNG, or WebP up to 8&nbsp;MB.</p>
    </Card>
  );
}
function ImagePicker({ label, url, onPick, wide }: { label: string; url: string | null; onPick: (f: File) => void; wide?: boolean }) {
  return (
    <label className="group cursor-pointer">
      <span className="bmpl-label">{label}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={`rounded-bmpl-md border border-slate-200 object-cover ${wide ? 'h-20 w-56' : 'h-20 w-20'}`} />
      ) : (
        <span
          className={`flex items-center justify-center rounded-bmpl-lg border-2 border-dashed border-slate-300 text-xs text-slate-400 transition group-hover:border-belize-accent group-hover:text-belize-blue ${wide ? 'h-20 w-56' : 'h-20 w-20'}`}
        >
          Upload
        </span>
      )}
      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </label>
  );
}

function SettingsForm({ store, onDone, onError }: SectionProps) {
  const s = store.settings!;
  const [f, setF] = useState({
    pickupEnabled: s.pickupEnabled,
    deliveryEnabled: s.deliveryEnabled,
    vacationMode: s.vacationMode,
    hideOutOfStock: s.hideOutOfStock,
    // Stored in cents, entered/displayed in dollars.
    minimumOrderMinor: centsToDollars(s.minimumOrderMinor),
  });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Operations">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.patch('/vendor/settings', {
              pickupEnabled: f.pickupEnabled,
              deliveryEnabled: f.deliveryEnabled,
              vacationMode: f.vacationMode,
              hideOutOfStock: f.hideOutOfStock,
              minimumOrderMinor: dollarsToCentsOrNull(f.minimumOrderMinor),
            });
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Check label="Pickup available" checked={f.pickupEnabled} onChange={(v) => setF({ ...f, pickupEnabled: v })} />
        <Check label="Delivery available" checked={f.deliveryEnabled} onChange={(v) => setF({ ...f, deliveryEnabled: v })} />
        <Check label="Vacation mode (temporarily hide)" checked={f.vacationMode} onChange={(v) => setF({ ...f, vacationMode: v })} />
        <Check
          label="Hide out-of-stock items (otherwise shown with an “Out of Stock” badge + Notify Me)"
          checked={f.hideOutOfStock}
          onChange={(v) => setF({ ...f, hideOutOfStock: v })}
        />
        <Field label="Minimum order (BZD)" hint="Optional — leave blank for no minimum.">
          <Input
            className="w-32"
            inputMode="decimal"
            value={f.minimumOrderMinor}
            onChange={(e) => setF({ ...f, minimumOrderMinor: e.target.value })}
            onBlur={(e) => setF({ ...f, minimumOrderMinor: centsToDollars(dollarsToCentsOrNull(e.target.value)) })}
            placeholder="25.00"
          />
        </Field>
        <Button disabled={busy}>Save operations</Button>
      </form>
    </Card>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function LocationsSection({ store, onDone, onError }: SectionProps) {
  const locations = store.locations ?? [];
  const [f, setF] = useState({ label: '', addressLine1: '', city: '', district: 'BELIZE', isPrimary: false, pickupInstructions: '' });
  const [pin, setPin] = useState<Coordinates | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Pickup locations">
      <p className="mb-3 text-sm text-slate-500">
        Drivers navigate to the pin you drop here. Without one they only get the written address, and the delivery
        distance we estimate is a district-level guess.
      </p>
      <ul className="mb-4 space-y-2">
        {locations.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600"
          >
            <span>
              <b className="text-belize-navy">{l.label}</b>
              {l.isPrimary && (
                <Badge tone="success" className="ml-2">
                  Primary
                </Badge>
              )}{' '}
              — {l.addressLine1}, {l.city}, {l.district}
              {l.latitude != null ? (
                <Badge tone="success" className="ml-2">
                  Pinned
                </Badge>
              ) : (
                <Badge tone="warning" className="ml-2">
                  No pin
                </Badge>
              )}
              {l.pickupInstructions && (
                <span className="mt-1 block text-xs text-slate-500">“{l.pickupInstructions}”</span>
              )}
            </span>
            <button
              className="text-xs font-semibold text-red-600 hover:underline"
              onClick={async () => {
                try {
                  await api.del(`/vendor/profile/locations/${l.id}`);
                  await onDone();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
        {locations.length === 0 && <li className="text-sm text-slate-400">No locations yet.</li>}
      </ul>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/vendor/profile/locations', {
              ...f,
              pickupInstructions: f.pickupInstructions.trim() || undefined,
              latitude: pin?.latitude,
              longitude: pin?.longitude,
            });
            setF({ label: '', addressLine1: '', city: '', district: 'BELIZE', isPrimary: false, pickupInstructions: '' });
            setPin(null);
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input placeholder="Label (e.g. Main)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <Input placeholder="Address" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
        <Input placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        <Select value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
          {DISTRICTS.map((d) => (
            <option key={d} value={d}>
              {d.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <div className="md:col-span-2">
          <Input
            placeholder="Pickup instructions for drivers (optional) — e.g. loading bay round the back"
            value={f.pickupInstructions}
            onChange={(e) => setF({ ...f, pickupInstructions: e.target.value })}
            maxLength={1000}
            aria-label="Pickup instructions for drivers"
          />
        </div>
        {/* The same picker the customer uses at checkout — one map component,
            one coordinate abstraction, one set of Belize bounds. */}
        <div className="md:col-span-2">
          <LocationPicker
            value={pin}
            onChange={setPin}
            disabled={busy}
            address={[f.addressLine1, f.city].filter(Boolean).join(', ')}
            district={f.district}
            heading="Pickup pin"
            hint="Drop the pin where drivers should actually collect from — the door they use, not the middle of the block."
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.isPrimary}
            onChange={(e) => setF({ ...f, isPrimary: e.target.checked })}
          />{' '}
          Primary
        </label>
        <Button disabled={busy || !f.label || !f.addressLine1 || !f.city}>Add location</Button>
      </form>
    </Card>
  );
}

function HoursSection({ store, onDone, onError }: SectionProps) {
  const existing = store.openingHours ?? [];
  const [rows, setRows] = useState(
    DAYS.map((_, day) => {
      const found = existing.find((h) => h.dayOfWeek === day);
      return {
        dayOfWeek: day,
        isClosed: found ? found.isClosed : true,
        openTime: found?.openTime ?? '09:00',
        closeTime: found?.closeTime ?? '17:00',
      };
    }),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Opening hours">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.dayOfWeek} className="flex flex-wrap items-center gap-3 rounded-bmpl-md border border-slate-100 px-3 py-2 text-sm">
            <span className="w-24 font-medium text-slate-600">{DAYS[r.dayOfWeek]}</span>
            <label className="flex items-center gap-1.5 text-slate-500">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
                checked={!r.isClosed}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, isClosed: !e.target.checked } : x)))}
              />
              Open
            </label>
            {!r.isClosed && (
              <>
                <input
                  type="time"
                  value={r.openTime}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, openTime: e.target.value } : x)))}
                  className="bmpl-input w-auto px-2 py-1"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  value={r.closeTime}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, closeTime: e.target.value } : x)))}
                  className="bmpl-input w-auto px-2 py-1"
                />
              </>
            )}
          </div>
        ))}
      </div>
      <Button
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.put('/vendor/profile/hours', {
              hours: rows.map((r) => ({
                dayOfWeek: r.dayOfWeek,
                isClosed: r.isClosed,
                openTime: r.isClosed ? undefined : r.openTime,
                closeTime: r.isClosed ? undefined : r.closeTime,
              })),
            });
            await onDone();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save hours
      </Button>
    </Card>
  );
}
