import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGet } from '../../../lib/server-api';
import { Gallery, type GalleryImage } from './Gallery';

export const dynamic = 'force-dynamic';

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  description: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  category: { name: string; slug: string };
  vendor: { businessName: string; slug: string };
  weightGrams: number | null;
  dimensionsMm: { length: number | null; width: number | null; height: number | null };
  tags: string[];
  images: GalleryImage[];
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function fetchProduct(slug: string): Promise<ProductDetail | null> {
  try {
    return await serverGet<ProductDetail>(`/marketplace/products/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const p = await fetchProduct(params.slug);
  if (!p) notFound();
  const dims = p.dimensionsMm;

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <Link href="/products" className="text-sm text-belize-blue hover:underline">← Shop</Link>
        <div className="mt-4 grid gap-8 md:grid-cols-2">
          <Gallery images={p.images} />

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{p.category.name}</p>
            <h1 className="mt-1 text-3xl font-bold text-belize-navy">{p.title}</h1>
            {p.brand && <p className="text-sm text-slate-500">by {p.brand}</p>}

            <p className="mt-4 text-2xl">
              {p.salePriceMinor != null ? (
                <>
                  <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
                  <span className="text-lg text-slate-400 line-through">{money(p.priceMinor)}</span>
                </>
              ) : (
                <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
              )}
              <span className="ml-2 text-sm text-slate-400">{p.currency}</span>
            </p>

            <p className="mt-2 text-sm text-slate-500">
              Sold by{' '}
              <Link href={`/store/${p.vendor.slug}`} className="text-belize-blue hover:underline">
                {p.vendor.businessName}
              </Link>
            </p>

            {p.description && <p className="mt-5 whitespace-pre-wrap text-slate-600">{p.description}</p>}

            {(p.weightGrams || dims.length || dims.width || dims.height) && (
              <dl className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600">
                {p.weightGrams && <div><dt className="text-slate-400">Weight</dt><dd>{p.weightGrams} g</dd></div>}
                {(dims.length || dims.width || dims.height) && (
                  <div><dt className="text-slate-400">Dimensions</dt><dd>{dims.length ?? '—'}×{dims.width ?? '—'}×{dims.height ?? '—'} mm</dd></div>
                )}
              </dl>
            )}

            {p.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
