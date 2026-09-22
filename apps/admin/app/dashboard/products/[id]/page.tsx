import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '../../../../lib/server-api';
import { AccessNotice } from '../../../../components/AccessNotice';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Alert, Badge, Breadcrumbs, Card } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { formatWeight } from '@bmpl/shared';
import { ProductModeration } from './ProductModeration';

export const dynamic = 'force-dynamic';

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  brand: string | null;
  status: string;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  weightGrams: number | null;
  featured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  category: { name: string };
  vendor: { businessName: string; slug: string };
  tags: string[];
  rejectionReason: string | null;
  images: Array<{ id: string; url: string | null; altText: string | null; isPrimary: boolean }>;
  reviews: Array<{ action: string; note: string | null; toStatus: string | null; createdAt: string; reviewer: string | null }>;
}

const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);

export default async function AdminProductDetail({ params }: { params: { id: string } }) {
  const res = await serverGet<ProductDetail>(`/admin/products/${params.id}`);
  // Refused and missing are different answers (BMPL-144): only a real 404
  // is "not found" - a 403 says so in the server's words.
  if (!res.ok) {
    if (res.status === 404) notFound();
    return <AccessNotice message={res.message} />;
  }
  const p = res.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs items={adminCrumbs(['Products', '/dashboard/products'], p.title)} className="mb-3" />
      <Link href="/dashboard/products" className="text-sm font-medium text-belize-blue hover:underline">← Products</Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="bmpl-page-title">{p.title}</h1>
          <p className="text-sm text-slate-500">
            {p.sku} · {p.category.name} · by{' '}
            <Link href={`/dashboard/vendors`} className="text-belize-blue hover:underline">{p.vendor.businessName}</Link>
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      {p.rejectionReason && (
        <Alert tone="error" className="mt-3">
          Rejection reason: {p.rejectionReason}
        </Alert>
      )}

      <ProductModeration id={p.id} status={p.status} />

      <Card className="mt-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Price">{money(p.priceMinor)} {p.currency}</Row>
          <Row label="Sale price">{money(p.salePriceMinor)}</Row>
          <Row label="Brand">{p.brand ?? '—'}</Row>
          <Row label="Barcode">{p.barcode ?? '—'}</Row>
          <Row label="Weight">{formatWeight(p.weightGrams) ?? '—'}</Row>
          <Row label="Featured">{p.featured ? 'Yes' : 'No'}</Row>
        </div>
        {p.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{p.description}</p>}
        {p.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.tags.map((t) => (
              <Badge key={t} tone="neutral">{t}</Badge>
            ))}
          </div>
        )}
        {(p.metaTitle || p.metaDescription) && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <p><b>SEO title:</b> {p.metaTitle ?? '—'}</p>
            <p><b>SEO description:</b> {p.metaDescription ?? '—'}</p>
          </div>
        )}
      </Card>

      {p.images.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Images ({p.images.length})</h2>
          <div className="flex flex-wrap gap-3">
            {p.images.map((img) => (
              <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-bmpl-md bg-slate-100">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.altText ?? ''} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-slate-400">no preview</span>
                )}
                {img.isPrimary && <span className="absolute left-0 top-0 bg-belize-blue px-1 text-[10px] font-bold text-white">PRIMARY</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Moderation history</h2>
        <ol className="space-y-2">
          {p.reviews.map((r, i) => (
            <li key={i} className="text-sm text-slate-600">
              <span className="font-medium text-belize-navy">{r.action}</span>
              {r.reviewer ? ` by ${r.reviewer}` : ''} · {new Date(r.createdAt).toLocaleString()}
              {r.note ? ` — ${r.note}` : ''}
            </li>
          ))}
          {p.reviews.length === 0 && <li className="text-sm text-slate-400">No history yet.</li>}
        </ol>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span> {children}
    </p>
  );
}
