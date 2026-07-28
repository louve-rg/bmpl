import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '../../../../lib/server-api';
import { StatusBadge } from '../../../../components/StatusBadge';
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
  if (!res.ok) notFound();
  const p = res.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard/products" className="text-sm text-belize-blue hover:underline">← Products</Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-belize-navy">{p.title}</h1>
          <p className="text-sm text-slate-500">
            {p.sku} · {p.category.name} · by{' '}
            <Link href={`/dashboard/vendors`} className="text-belize-blue hover:underline">{p.vendor.businessName}</Link>
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      {p.rejectionReason && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Rejection reason: {p.rejectionReason}
        </p>
      )}

      <ProductModeration id={p.id} status={p.status} />

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Price">{money(p.priceMinor)} {p.currency}</Row>
          <Row label="Sale price">{money(p.salePriceMinor)}</Row>
          <Row label="Brand">{p.brand ?? '—'}</Row>
          <Row label="Barcode">{p.barcode ?? '—'}</Row>
          <Row label="Weight">{p.weightGrams ? `${p.weightGrams} g` : '—'}</Row>
          <Row label="Featured">{p.featured ? 'Yes' : 'No'}</Row>
        </div>
        {p.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{p.description}</p>}
        {p.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>
            ))}
          </div>
        )}
        {(p.metaTitle || p.metaDescription) && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <p><b>SEO title:</b> {p.metaTitle ?? '—'}</p>
            <p><b>SEO description:</b> {p.metaDescription ?? '—'}</p>
          </div>
        )}
      </section>

      {p.images.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Images ({p.images.length})</h2>
          <div className="flex flex-wrap gap-3">
            {p.images.map((img) => (
              <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-lg bg-slate-100">
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
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Moderation history</h2>
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
      </section>
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
