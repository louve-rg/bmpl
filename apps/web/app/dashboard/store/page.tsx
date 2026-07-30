'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';

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
    minimumOrderMinor: number | null;
  };
  locations?: Array<{ id: string; label: string; addressLine1: string; city: string; district: string; isPrimary: boolean }>;
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

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-belize-navy">My Store</h1>
      {msg && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">{msg}</p>
      )}

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
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
const input =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30';
const btn = 'rounded-lg bg-belize-blue px-4 py-2 text-sm font-semibold text-white hover:bg-belize-deep disabled:opacity-50';

type SectionProps = { store: Store; onDone: () => Promise<void>; onError: (e: unknown) => void };

function CreateForm({ onDone, onError }: { onDone: () => Promise<void>; onError: (e: unknown) => void }) {
  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Create your storefront">
      <form
        className="space-y-3"
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
        <input className={input} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        <input className={input} placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        <button className={btn} disabled={busy || !businessName || !contactEmail}>
          Create storefront
        </button>
      </form>
    </Card>
  );
}

function StatusBar({ store, onDone, onError }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const status = store.profile!.approvalStatus;
  const canSubmit = status === 'DRAFT' || status === 'REJECTED';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="text-sm text-slate-600">
        Approval: <b className="text-belize-navy">{status}</b> · Store: {store.profile!.storeStatus}
      </span>
      {store.profile!.rejectionReason && status === 'REJECTED' && (
        <span className="text-sm text-red-600">Reason: {store.profile!.rejectionReason}</span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/dashboard/store/preview"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Preview storefront
        </Link>
        {canSubmit && (
          <button
            className={btn}
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
          </button>
        )}
        {status === 'PENDING' && <span className="text-sm text-slate-500">Awaiting admin review…</span>}
        {status === 'APPROVED' && <span className="text-sm text-emerald-600">Live ✓</span>}
      </div>
    </div>
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
        className="space-y-3"
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
        <input className={input} value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Business name" />
        <textarea className={input} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" />
        <div className="grid gap-3 md:grid-cols-2">
          <input className={input} value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="Contact email" />
          <input className={input} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="Contact phone" />
        </div>
        <input className={input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Store status:
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={f.storeStatus} onChange={(e) => setF({ ...f, storeStatus: e.target.value })}>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <button className={btn} disabled={busy}>Save details</button>
      </form>
    </Card>
  );
}

function ImagesSection({ store, onDone, onError }: SectionProps) {
  const p = store.profile!;
  async function upload(kind: 'logo' | 'banner', file: File) {
    try {
      const presign = await api.post<{ uploadUrl: string; key: string }>(`/vendor/profile/${kind}/presign`, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw { message: 'Upload to storage failed.' };
      await api.post(`/vendor/profile/${kind}/confirm`, { key: presign.key });
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
      <p className="mt-2 text-xs text-slate-400">JPEG, PNG, or WebP up to 8&nbsp;MB.</p>
    </Card>
  );
}
function ImagePicker({ label, url, onPick, wide }: { label: string; url: string | null; onPick: (f: File) => void; wide?: boolean }) {
  return (
    <label className="cursor-pointer">
      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{label}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={`rounded-lg object-cover ${wide ? 'h-20 w-56' : 'h-20 w-20'}`} />
      ) : (
        <span className={`flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 ${wide ? 'h-20 w-56' : 'h-20 w-20'}`}>
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
    minimumOrderMinor: s.minimumOrderMinor?.toString() ?? '',
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
              minimumOrderMinor: f.minimumOrderMinor === '' ? null : Number(f.minimumOrderMinor),
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
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Minimum order (cents):
          <input className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={f.minimumOrderMinor} onChange={(e) => setF({ ...f, minimumOrderMinor: e.target.value })} placeholder="none" />
        </label>
        <button className={btn} disabled={busy}>Save operations</button>
      </form>
    </Card>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function LocationsSection({ store, onDone, onError }: SectionProps) {
  const locations = store.locations ?? [];
  const [f, setF] = useState({ label: '', addressLine1: '', city: '', district: 'BELIZE', isPrimary: false });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Locations">
      <ul className="mb-3 space-y-1">
        {locations.map((l) => (
          <li key={l.id} className="flex items-center justify-between text-sm text-slate-600">
            <span>
              <b>{l.label}</b>
              {l.isPrimary && <span className="ml-1 text-xs text-emerald-600">(primary)</span>} — {l.addressLine1}, {l.city}, {l.district}
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
        className="grid gap-2 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/vendor/profile/locations', f);
            setF({ label: '', addressLine1: '', city: '', district: 'BELIZE', isPrimary: false });
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className={input} placeholder="Label (e.g. Main)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <input className={input} placeholder="Address" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
        <input className={input} placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        <select className={input} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
          {DISTRICTS.map((d) => (
            <option key={d} value={d}>{d.replace('_', ' ')}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary
        </label>
        <button className={btn} disabled={busy || !f.label || !f.addressLine1 || !f.city}>Add location</button>
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
          <div key={r.dayOfWeek} className="flex items-center gap-3 text-sm">
            <span className="w-24 text-slate-600">{DAYS[r.dayOfWeek]}</span>
            <label className="flex items-center gap-1 text-slate-500">
              <input
                type="checkbox"
                checked={!r.isClosed}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, isClosed: !e.target.checked } : x)))}
              />
              Open
            </label>
            {!r.isClosed && (
              <>
                <input type="time" value={r.openTime} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, openTime: e.target.value } : x)))} className="rounded border border-slate-300 px-2 py-1" />
                <span>–</span>
                <input type="time" value={r.closeTime} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, closeTime: e.target.value } : x)))} className="rounded border border-slate-300 px-2 py-1" />
              </>
            )}
          </div>
        ))}
      </div>
      <button
        className={`${btn} mt-3`}
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
      </button>
    </Card>
  );
}
