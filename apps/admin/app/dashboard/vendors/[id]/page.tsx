import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '../../../../lib/server-api';
import { AccessNotice } from '../../../../components/AccessNotice';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Alert, Breadcrumbs } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { VendorModeration } from './VendorModeration';

export const dynamic = 'force-dynamic';

interface VendorDetail {
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
  owner: { email: string; firstName: string; lastName: string };
  settings: Record<string, unknown> | null;
  locations: Array<{ id: string; label: string; addressLine1: string; city: string; district: string; isPrimary: boolean }>;
  openingHours: Array<{ dayOfWeek: number; isClosed: boolean; openTime: string | null; closeTime: string | null }>;
  reviews: Array<{ action: string; note: string | null; toStatus: string | null; createdAt: string; reviewer: string | null }>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  const res = await serverGet<VendorDetail>(`/admin/vendors/${params.id}`);
  // Refused and missing are different answers (BMPL-144): only a real 404
  // is "not found" - a 403 says so in the server's words.
  if (!res.ok) {
    if (res.status === 404) notFound();
    return <AccessNotice message={res.message} />;
  }
  const v = res.data;

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumbs items={adminCrumbs(['Vendors', '/dashboard/vendors'], v.businessName)} className="mb-3" />
      <Link href="/dashboard/vendors" className="text-sm font-medium text-belize-blue hover:underline">
        ← Vendors
      </Link>

      {v.bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.bannerUrl} alt="" className="mt-4 h-40 w-full rounded-bmpl-xl object-cover" />
      )}

      <div className="mt-4 flex items-center gap-4">
        {v.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.logoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        )}
        <div className="flex-1">
          <h1 className="bmpl-page-title">{v.businessName}</h1>
          <p className="text-sm text-slate-500">/{v.slug}</p>
        </div>
        <StatusBadge status={v.approvalStatus} />
      </div>

      {v.rejectionReason && (
        <Alert tone="error" className="mt-3">
          Rejection reason: {v.rejectionReason}
        </Alert>
      )}

      <VendorModeration id={v.id} status={v.approvalStatus} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <InfoCard title="Business">
          <Row label="Owner">{v.owner.firstName} {v.owner.lastName} ({v.owner.email})</Row>
          <Row label="Contact">{v.contactEmail}{v.contactPhone ? ` · ${v.contactPhone}` : ''}</Row>
          {v.website && <Row label="Website">{v.website}</Row>}
          <Row label="Store status">{v.storeStatus}</Row>
          {v.description && <p className="mt-2 text-sm text-slate-600">{v.description}</p>}
        </InfoCard>

        <InfoCard title="Locations">
          {v.locations.length === 0 && <p className="text-sm text-slate-400">None</p>}
          {v.locations.map((l) => (
            <p key={l.id} className="text-sm text-slate-600">
              <span className="font-medium">{l.label}</span>
              {l.isPrimary && <span className="ml-1 text-xs text-emerald-600">(primary)</span>} — {l.addressLine1}, {l.city}, {l.district}
            </p>
          ))}
        </InfoCard>

        <InfoCard title="Opening hours">
          {v.openingHours.length === 0 && <p className="text-sm text-slate-400">Not set</p>}
          {v.openingHours.map((h) => (
            <p key={h.dayOfWeek} className="text-sm text-slate-600">
              {DAYS[h.dayOfWeek]}: {h.isClosed ? 'Closed' : `${h.openTime}–${h.closeTime}`}
            </p>
          ))}
        </InfoCard>

        <InfoCard title="Settings">
          {v.settings ? (
            <ul className="text-sm text-slate-600">
              <li>Pickup: {String((v.settings as Record<string, unknown>).pickupEnabled)}</li>
              <li>Delivery: {String((v.settings as Record<string, unknown>).deliveryEnabled)}</li>
              <li>Vacation mode: {String((v.settings as Record<string, unknown>).vacationMode)}</li>
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Defaults</p>
          )}
        </InfoCard>
      </div>

      <InfoCard title="Moderation history">
        <ol className="space-y-2">
          {v.reviews.map((r, i) => (
            <li key={i} className="text-sm text-slate-600">
              <span className="font-medium text-belize-navy">{r.action}</span>
              {r.reviewer ? ` by ${r.reviewer}` : ''} · {new Date(r.createdAt).toLocaleString()}
              {r.note ? ` — ${r.note}` : ''}
            </li>
          ))}
        </ol>
      </InfoCard>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span> {children}
    </p>
  );
}
